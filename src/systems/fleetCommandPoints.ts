// Issue #69 — Command Points (CP) + Deployment Points (DP).
//
// Two coupled fleet-combat economies, both gated by player skill + the
// flagship's comm suite (Design/fleet.md §Command points / §Deployment
// points), both diegetically justified by Minovsky-particle comm scatter:
//
//   DP — pre-engagement budget. Before a fight the player commits a subset
//        of the active fleet up to a Deployment-Point cap; the rest hold
//        station. Each ship class declares `dpCost`. Over-budget commits
//        are refused with a legible reason (mirrors the hangar-capacity
//        gate discipline).
//
//   CP — in-engagement bandwidth. A regenerating pool spent by fleet-wide
//        orders (rally, focus-fire, retreat, formation change, MS launch
//        authorization). When the pool runs dry the fleet acts on standing
//        per-ship aggression doctrine only.
//
// Skill stand-in (Issue #69): the designed `shipCommand` / `tactics` /
// `command` skills are deferred (Design/characters/skills.md — a skill
// earns an id only when a trainer verb AND a consumer ship together).
// The formulas read existing shipped skills as stand-ins, keyed in
// fleetConfig so the later swap to real skills is config-only:
//   - player command + tactics  → player `piloting` level
//   - flagship comm officer's command → assigned captain's `engineering`
//     level (the same skill the captain officer-Effect already reads).
//
// Perf budget (Issue #69, CLAUDE.md): CP regen + doctrine evaluation run
// per tactical tick across all deployed units.
//   Target N : ~8 ships + ~12 MS deployed (DP-capped subset of a large fleet).
//   Budget   : <0.1 ms/tick for CP regen + doctrine evaluation aggregate.
//   Complexity: O(D), D = deployed unit count. CP regen is O(1) (one pool
//               increment per tick, not per unit). Doctrine evaluation is
//               O(1) per unit at spawn (the per-tick AI directive reads the
//               already-resolved aggression off CombatShipState; no
//               cross-entity scan). No nested loops over the fleet.
//   Profile  : set CPDP_PROF=1 (mirrors HPA_PROF=1 in src/systems/hpa.ts).

import { create } from 'zustand'
import type { Entity } from 'koota'
import {
  Ship, IsInActiveFleet, IsFlagshipMark, EntityKey, ShipStatSheet,
  type ShipStatId,
} from '../ecs/traits'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { getStat } from '../stats/sheet'
import { fleetConfig } from '../config'
import { getSkillXp, levelOf, type SkillId } from '../character/skills'
import { findPlayerEntity } from './fleetPlayer'
import { pushCombatLog } from '../sim/combatLog'

const SHIP_SCENE_ID = 'playerShipInterior'

// CPDP_PROF=1 — emit a one-line profile of the per-tick regen+doctrine
// aggregate cost. Env read is hoisted so the per-tick path stays branch-cheap.
const CPDP_PROF =
  typeof process !== 'undefined' && process.env && process.env.CPDP_PROF === '1'
let profAccumMs = 0
let profTicks = 0

function profReport(): void {
  if (!CPDP_PROF || profTicks === 0) return
  // eslint-disable-next-line no-console
  console.log(
    `[CPDP_PROF] ticks=${profTicks} avg=${(profAccumMs / profTicks).toFixed(4)}ms/tick`,
  )
}

// ── Skill reads (stand-in; see header) ──────────────────────────────────

function playerSkillLevel(skill: string): number {
  const player = findPlayerEntity()
  if (!player) return 0
  return levelOf(getSkillXp(player, skill as SkillId))
}

// The flagship's assigned captain stands in for the "comm officer." Empty
// seat → 0 contribution. The flagship Ship entity itself usually leaves
// assignedCaptainId empty (the player is the captain), so this term is
// non-zero only once the player hires a dedicated comm officer onto the
// flagship — matching the design's "flagship comm suite" framing.
function flagshipCommOfficerSkillLevel(skill: string): number {
  const w = getWorld(SHIP_SCENE_ID)
  const flagship = w.queryFirst(Ship, IsFlagshipMark)
  if (!flagship) return 0
  const captainKey = flagship.get(Ship)!.assignedCaptainId
  if (!captainKey) return 0
  // The captain may have hopped between scene worlds; scan all of them for
  // the EntityKey (matches fleetCrew.findNpcByKey's multi-scene discipline).
  for (const sceneId of SCENE_IDS) {
    const sw = getWorld(sceneId)
    for (const e of sw.query(EntityKey)) {
      if (e.get(EntityKey)!.key !== captainKey) continue
      return levelOf(getSkillXp(e, skill as SkillId))
    }
  }
  return 0
}

// ── Deployment Points (pre-engagement budget) ───────────────────────────

// dpCost for a ship entity, read off its StatSheet (dpCost stat base set at
// spawn from the ship class). Falls back to 0 when the sheet/stat is absent.
export function dpCostForShip(ship: Entity): number {
  if (!ship.has(ShipStatSheet)) return 0
  return Math.max(0, getStat(ship.get(ShipStatSheet)!.sheet, 'dpCost' as ShipStatId))
}

// DP cap = base + floor(playerCmd / shipCommandPerDp)
//               + floor(commOfficer / commOfficerPerDp), clamped to maxCapCap.
export function computeDpCap(): number {
  const cfg = fleetConfig.deploymentPoints
  const playerCmd = playerSkillLevel(cfg.playerCommandSkill)
  const officerCmd = flagshipCommOfficerSkillLevel(cfg.commOfficerSkill)
  const cap =
    cfg.base
    + Math.floor(playerCmd / cfg.shipCommandPerDp)
    + Math.floor(officerCmd / cfg.commOfficerPerDp)
  return Math.min(cfg.maxCapCap, cap)
}

export interface DeploymentView {
  cap: number
  committed: number          // total dpCost of committed ships
  committedShipKeys: string[]
}

export type CommitFailReason =
  | 'ship_not_found'
  | 'ship_not_active'
  | 'over_budget'

export type CommitResult =
  | { ok: true; committed: number; cap: number }
  | { ok: false; reason: CommitFailReason; committed: number; cap: number }

// The committed set is per-engagement transient state (matches CombatShipState
// + the brig pending-tally pattern — not persisted). Stored on a zustand
// store so the war-room UI + debug handle read one source of truth.
interface CpDpState {
  // CP pool.
  cpCurrent: number
  cpMax: number
  cpRegenAccumSec: number
  // DP commit set.
  committedShipKeys: string[]
  setCp: (current: number, max: number) => void
  setCpCurrent: (current: number) => void
  setCpRegenAccum: (sec: number) => void
  setCommitted: (keys: string[]) => void
  reset: () => void
}

export const useCpDp = create<CpDpState>((set) => ({
  cpCurrent: 0,
  cpMax: 0,
  cpRegenAccumSec: 0,
  committedShipKeys: [],
  setCp: (cpCurrent, cpMax) => set({ cpCurrent, cpMax }),
  setCpCurrent: (cpCurrent) => set({ cpCurrent }),
  setCpRegenAccum: (cpRegenAccumSec) => set({ cpRegenAccumSec }),
  setCommitted: (committedShipKeys) => set({ committedShipKeys }),
  reset: () => set({
    cpCurrent: 0, cpMax: 0, cpRegenAccumSec: 0, committedShipKeys: [],
  }),
}))

function committedDpTotal(keys: string[]): number {
  let total = 0
  for (const k of keys) {
    const ship = findActiveShipByKey(k)
    if (ship) total += dpCostForShip(ship)
  }
  return total
}

// Active-fleet ship lookup by key. DP commit is only valid for ships the
// war room has placed in the active fleet (Design/fleet.md: only active
// ships participate in DP commit).
function findActiveShipByKey(shipKey: string): Entity | null {
  const w = getWorld(SHIP_SCENE_ID)
  for (const e of w.query(Ship, IsInActiveFleet, EntityKey)) {
    if (e.get(EntityKey)!.key === shipKey) return e
  }
  return null
}

export function deploymentDescribe(): DeploymentView {
  const cap = computeDpCap()
  const keys = useCpDp.getState().committedShipKeys
  return { cap, committed: committedDpTotal(keys), committedShipKeys: [...keys] }
}

// Commit one active-fleet ship to the next engagement. Refuses when the
// ship isn't active or when adding its dpCost would exceed the cap. The
// flagship is always implicitly committed and need not be added.
export function commitShipToEngagement(shipKey: string): CommitResult {
  const cap = computeDpCap()
  const state = useCpDp.getState()
  const keys = state.committedShipKeys
  if (keys.includes(shipKey)) {
    // Idempotent — already committed.
    return { ok: true, committed: committedDpTotal(keys), cap }
  }
  const ship = findActiveShipByKey(shipKey)
  if (!ship) {
    // Distinguish "no such ship at all" from "exists but not active".
    const anyShip = findShipByKeyAnyState(shipKey)
    return {
      ok: false,
      reason: anyShip ? 'ship_not_active' : 'ship_not_found',
      committed: committedDpTotal(keys),
      cap,
    }
  }
  const nextKeys = [...keys, shipKey]
  const nextTotal = committedDpTotal(nextKeys)
  if (nextTotal > cap) {
    return { ok: false, reason: 'over_budget', committed: committedDpTotal(keys), cap }
  }
  state.setCommitted(nextKeys)
  return { ok: true, committed: nextTotal, cap }
}

export function uncommitShipFromEngagement(shipKey: string): CommitResult {
  const cap = computeDpCap()
  const state = useCpDp.getState()
  const nextKeys = state.committedShipKeys.filter((k) => k !== shipKey)
  state.setCommitted(nextKeys)
  return { ok: true, committed: committedDpTotal(nextKeys), cap }
}

export function clearDeploymentCommit(): void {
  useCpDp.getState().setCommitted([])
}

function findShipByKeyAnyState(shipKey: string): Entity | null {
  const w = getWorld(SHIP_SCENE_ID)
  for (const e of w.query(Ship, EntityKey)) {
    if (e.get(EntityKey)!.key === shipKey) return e
  }
  return null
}

// ── Command Points (in-engagement bandwidth) ────────────────────────────

// maxCommandPoints = base + playerCmd/shipCommandDivisor
//                         + playerTactics/tacticsDivisor
//                         + commOfficer/commOfficerDivisor, clamped.
export function computeMaxCommandPoints(): number {
  const cfg = fleetConfig.commandPoints
  const playerCmd = playerSkillLevel(cfg.playerCommandSkill)
  const playerTac = playerSkillLevel(cfg.playerTacticsSkill)
  const officerCmd = flagshipCommOfficerSkillLevel(cfg.commOfficerSkill)
  const max =
    cfg.base
    + playerCmd / cfg.shipCommandDivisor
    + playerTac / cfg.tacticsDivisor
    + officerCmd / cfg.commOfficerDivisor
  return Math.min(cfg.maxPoolCap, Math.floor(max))
}

// Called at startCombat — seed the pool full. Resets regen accumulator.
export function initCommandPoolForEngagement(): void {
  const max = computeMaxCommandPoints()
  useCpDp.getState().setCp(max, max)
  useCpDp.getState().setCpRegenAccum(0)
}

export interface CommandPoolView {
  current: number
  max: number
}

export function commandPoolDescribe(): CommandPoolView {
  const s = useCpDp.getState()
  return { current: s.cpCurrent, max: s.cpMax }
}

export type OrderResult =
  | { ok: true; spent: number; remaining: number }
  | { ok: false; reason: 'unknown_order' | 'insufficient_cp'; remaining: number }

// Spend CP on a fleet-wide order. Refuses (without debiting) when the pool
// can't cover the cost — the fleet then acts on standing doctrine, and the
// caller logs a `CP exhausted` line via maybeLogExhausted below.
export function issueFleetOrder(orderId: string): OrderResult {
  const cfg = fleetConfig.commandPoints
  const cost = cfg.orderCosts[orderId]
  const s = useCpDp.getState()
  if (cost === undefined) {
    return { ok: false, reason: 'unknown_order', remaining: s.cpCurrent }
  }
  if (s.cpCurrent < cost) {
    pushCombatLog('指挥点耗尽 · 舰队转入既定交战条令', 'warn')
    return { ok: false, reason: 'insufficient_cp', remaining: s.cpCurrent }
  }
  const remaining = s.cpCurrent - cost
  s.setCpCurrent(remaining)
  return { ok: true, spent: cost, remaining }
}

// Per-tactical-tick CP regen. Accumulates fractional CP; the pool only
// increments by whole points (fractional remainder carries). On each whole-
// point gain a `CP regen` info log fires. O(1) — no per-unit work. Returns
// the whole points gained this tick (0 normally).
export function regenCommandPoints(dtSec: number): number {
  const t0 = CPDP_PROF ? performance.now() : 0
  const cfg = fleetConfig.commandPoints
  const s = useCpDp.getState()
  let gained = 0
  if (s.cpMax > 0 && s.cpCurrent < s.cpMax) {
    let accum = s.cpRegenAccumSec + cfg.regenPerSec * dtSec
    while (accum >= 1 && s.cpCurrent + gained < s.cpMax) {
      accum -= 1
      gained += 1
    }
    if (gained > 0) {
      const next = Math.min(s.cpMax, s.cpCurrent + gained)
      s.setCpCurrent(next)
      pushCombatLog(`指挥点恢复 · ${next}/${s.cpMax}`, 'info')
    }
    s.setCpRegenAccum(accum)
  }
  if (CPDP_PROF) {
    profAccumMs += performance.now() - t0
    profTicks += 1
    if (profTicks % 600 === 0) profReport()
  }
  return gained
}

// Per-day campaign partial refill — applied on day rollover. Tops the pool
// up by dailyRefillFraction × max, clamped to max. No-op when no engagement
// has seeded a pool (cpMax === 0). Logs nothing (campaign-side, not tactical).
export function dailyRefillCommandPoints(): void {
  const cfg = fleetConfig.commandPoints
  const s = useCpDp.getState()
  if (s.cpMax <= 0) return
  // Floor the refill so the pool stays integer-valued (orders cost whole
  // points; a fractional pool would surface as e.g. "3.5/7" in the UI).
  const refill = Math.floor(s.cpMax * cfg.dailyRefillFraction)
  s.setCpCurrent(Math.min(s.cpMax, s.cpCurrent + refill))
}

// Resolve the doctrine row for a ship's aggression id. Used by combat at
// escort spawn to map the standing slider into close/hold tactical behavior.
// Falls back to the default aggression row when the id is unknown.
export function doctrineForAggression(aggression: string): {
  aiAggression: number
  maintainRangeMul: number
  retreatThresholdMul: number
} {
  const lvls = fleetConfig.aggressionLevels
  const row = lvls.find((a) => a.id === aggression)
    ?? lvls.find((a) => a.id === fleetConfig.aggressionDefault)
    ?? lvls[0]
  return {
    aiAggression: row.aiAggression,
    maintainRangeMul: row.maintainRangeMul,
    retreatThresholdMul: row.retreatThresholdMul,
  }
}
