// Issue #71 — recoverables (post-combat hull / pod recovery). After the
// last hostile is disabled, the recoverables dialogue lists every survivor
// hull and ejected pod and fires BEFORE the post-combat tally. Per hull:
// Recover / Salvage / Scuttle. Per pod: Recover / Leave. The player may
// close early → defaults apply (scuttle hulls, leave pods).
//
// The accumulator is populated at combat resolution from each broken-down
// hostile (onEnemyDestroyed) — every downed hull is a recoverable candidate
// and rolls a seeded pod ejection. endCombat stashes the would-be tally
// payload and emits `ui:open-recoverables`; RecoverablesPanel resolves the
// choices then calls finishRecoverables(), which applies defaults to any
// unresolved entry and emits `ui:open-combat-tally`.
//
// Perf (CLAUDE.md budget): the accumulator build + resolution runs ONCE at
// combat resolution — O(survivors + pods), trivially sub-budget at the
// fleet scale here (a handful of hulls). In-flight recovered hulls drawing
// their own bunkers on day:rollover fold into the existing per-ship supply
// walk (already O(ships)); no new per-tick cost.

import type { Entity } from 'koota'
import {
  Ship, EntityKey, Owner, IsFlagshipMark, WasCaptured, Money, IsPlayer,
} from '../ecs/traits'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { getEnemyShip } from '../data/enemyShips'
import { getShipClass } from '../data/ship-classes'
import { defaultShipName } from '../data/shipNaming'
import { attachShipStatSheet } from '../ecs/shipEffects'
import { grantFuel, grantSupplies } from '../sim/ship'
import { emitSim, type CombatTallyEventPayload } from '../sim/events'
import { pushCombatLog } from '../sim/combatLog'
import { fleetConfig } from '../config'
import { capturePrisoner } from './prisoners'
import { getBrigOccupancy, useBrig } from '../sim/brig'
import type { HullTierSalvageYield } from '../config/fleet'
import { getSpecialNpcById } from '../character/specialNpcs'

function findPlayerEntity(): Entity | undefined {
  for (const id of SCENE_IDS) {
    const e = getWorld(id).queryFirst(IsPlayer)
    if (e) return e
  }
  return undefined
}

const SHIP_SCENE_ID = 'playerShipInterior'

// ── Accumulator ────────────────────────────────────────────────────────

export interface RecoverableHull {
  id: string
  shipClassId: string   // enemyShips.json5 id
  nameZh: string
  // Hull / armor at the moment of disable (end-of-combat values).
  hullCurrent: number
  armorCurrent: number
  resolution: 'pending' | 'recover' | 'salvage' | 'scuttle'
}

export interface RecoverablePod {
  id: string
  // Occupant — a named special-NPC id when the hull had a notable
  // captain, else an anonymous generated id.
  occupantId: string
  nameZh: string
  titleZh?: string
  contextZh: string
  factionId: string
  resolution: 'pending' | 'recover' | 'leave'
}

interface RecoverablesState {
  hulls: RecoverableHull[]
  pods: RecoverablePod[]
}

let accum: RecoverablesState = { hulls: [], pods: [] }
let pendingTally: CombatTallyEventPayload | null = null
let hullCounter = 0
let podCounter = 0

export function resetRecoverables(): void {
  accum = { hulls: [], pods: [] }
  pendingTally = null
}

// Record one broken-down hostile as a recoverable. Called from
// onEnemyDestroyed at the instant the hull is disabled (before destroy()),
// so the hull's end-of-combat hull/armor are captured. Rolls a seeded pod
// ejection: a named captain always ejects; anonymous hulls eject with a
// seeded chance. The pod occupant routes to the brig only if the player
// chooses Recover on the pod.
export function recordRecoverable(cs: {
  shipClassId: string
  nameZh: string
  hullCurrent: number
  armorCurrent: number
  captainId: string
}): void {
  const hullId = `rec-hull-${++hullCounter}`
  accum.hulls.push({
    id: hullId,
    shipClassId: cs.shipClassId,
    nameZh: cs.nameZh,
    hullCurrent: Math.max(0, cs.hullCurrent),
    armorCurrent: Math.max(0, cs.armorCurrent),
    resolution: 'pending',
  })

  // Pod ejection. A disabled hull's surviving crew take to a pod; a named
  // captain (if any) is captured with the hull, so the pod here always
  // carries anonymous crew. Deterministic (one pod per disabled hull) so
  // the recoverables list is reproducible from the seed.
  const podId = `rec-pod-${++podCounter}`
  if (cs.captainId) {
    const npc = getSpecialNpcById(cs.captainId)
    accum.pods.push({
      id: podId,
      occupantId: cs.captainId,
      nameZh: npc?.name ?? cs.captainId,
      titleZh: npc?.title,
      contextZh: npc?.contextZh ?? npc?.title ?? '',
      factionId: npc?.factionRole?.faction ?? 'pirate',
      resolution: 'pending',
    })
  } else {
    accum.pods.push({
      id: podId,
      occupantId: podId,
      nameZh: '敌舰幸存乘员',
      contextZh: '逃生舱里的匿名乘员。',
      factionId: 'pirate',
      resolution: 'pending',
    })
  }
}

export function getRecoverables(): RecoverablesState {
  return { hulls: accum.hulls.map((h) => ({ ...h })), pods: accum.pods.map((p) => ({ ...p })) }
}

export function hasRecoverables(): boolean {
  return accum.hulls.length > 0 || accum.pods.length > 0
}

// ── Prize-crew gate ────────────────────────────────────────────────────

function getFlagship(): Entity | null {
  return getWorld(SHIP_SCENE_ID).queryFirst(Ship, IsFlagshipMark) ?? null
}

// Idle flagship crew available to dedicate as a prize crew. The flagship's
// crew complement is the pool; the player dedicates a slice to fly the
// captured hull.
function idleFlagshipCrew(): number {
  const fs = getFlagship()
  if (!fs) return 0
  return fs.get(Ship)!.crewIds.length
}

function tierOf(shipClassId: string): string {
  const tmplId = getEnemyShip(shipClassId).recoverTemplateId
  return getShipClass(tmplId).hangarSlotClass
}

export function prizeCrewRequired(shipClassId: string): number {
  const crew = getEnemyShip(shipClassId).crewRequired
  return Math.ceil(crew / fleetConfig.recoverables.prizeCrewDivisor)
}

// Whether Recover is available for a hull: enough idle flagship crew for
// the prize crew. Returns the plain reason when gated.
export function canRecoverHull(hullId: string): { ok: boolean; reasonZh?: string } {
  const hull = accum.hulls.find((h) => h.id === hullId)
  if (!hull) return { ok: false, reasonZh: '无此舰体。' }
  const need = prizeCrewRequired(hull.shipClassId)
  const have = idleFlagshipCrew()
  if (have < need) {
    return { ok: false, reasonZh: '舰上闲置船员不足，无法派出接管船体的拿捕船员。' }
  }
  return { ok: true }
}

// ── Per-hull resolution ────────────────────────────────────────────────

export interface RecoverHullResult {
  ok: boolean
  reasonZh?: string
  entityKey?: string
}

// Recover — spawn a salvaged in-flight Ship instance: reserve (no
// IsInActiveFleet), not mothballed, WasCaptured, homeHangarId empty (the
// `null` of the in-flight pattern), bunkers at half the recovered class's
// caps, hull/armor at end-of-combat values, captain = prize-crew lead. The
// prize crew is moved off the flagship onto the new hull.
export function recoverHull(hullId: string): RecoverHullResult {
  const hull = accum.hulls.find((h) => h.id === hullId)
  if (!hull) return { ok: false, reasonZh: '无此舰体。' }
  const gate = canRecoverHull(hullId)
  if (!gate.ok) return { ok: false, reasonZh: gate.reasonZh }

  // Supply cost from the fleet pool.
  const tier = tierOf(hull.shipClassId)
  const supplyCost = fleetConfig.recoverables.salvageRecoverSupplyCost[tier] ?? 0
  if (supplyCost > 0) grantSupplies(-supplyCost)

  const tmplId = getEnemyShip(hull.shipClassId).recoverTemplateId
  const cls = getShipClass(tmplId)

  // Move the prize crew off the flagship.
  const need = prizeCrewRequired(hull.shipClassId)
  const fs = getFlagship()
  const prizeCrew: string[] = []
  if (fs) {
    const s = fs.get(Ship)!
    const taken = s.crewIds.slice(0, need)
    prizeCrew.push(...taken)
    fs.set(Ship, { ...s, crewIds: s.crewIds.slice(need) })
  }
  const captain = prizeCrew[0] ?? ''

  const shipWorld = getWorld(SHIP_SCENE_ID)
  // Key off the hull's unique accumulator id so two recovered hulls of the
  // same class in one engagement don't collide on EntityKey.
  const key = `ship-captured-${hull.id}`
  const ent = shipWorld.spawn(
    Ship({
      templateId: cls.id,
      name: defaultShipName(cls),
      hullCurrent: hull.hullCurrent, hullMax: cls.hullMax,
      armorCurrent: hull.armorCurrent, armorMax: cls.armorMax,
      fluxMax: cls.fluxMax, fluxCurrent: 0,
      fluxDissipation: cls.fluxDissipation,
      hasShield: cls.hasShield,
      shieldEfficiency: cls.shieldEfficiency,
      topSpeed: cls.topSpeed,
      accel: cls.accel,
      decel: cls.decel,
      angularAccel: cls.angularAccel,
      maxAngVel: cls.maxAngVel,
      crCurrent: cls.crMax, crMax: cls.crMax,
      // In-flight, not docked: station-keeps with the formation.
      dockedAtPoiId: '',
      fleetPos: { x: 0, y: 0 },
      inCombat: false,
      mothballed: false,
      assignedCaptainId: captain,
      crewIds: prizeCrew,
      aggression: fleetConfig.aggressionDefault,
      formationSlot: -1,
      // Issue #71 — the in-flight pattern: no home hangar, own bunkers.
      homeHangarId: '',
      currentSupply: Math.floor(cls.suppliesMax / 2),
      currentFuel: Math.floor(cls.fuelMax / 2),
    }),
    EntityKey({ key }),
    Owner({ kind: 'character', entity: null }),
    WasCaptured,
  )
  attachShipStatSheet(ent)
  hull.resolution = 'recover'
  pushCombatLog(`接管舰体 · ${cls.nameZh}`, 'narr')
  return { ok: true, entityKey: key }
}

// Salvage — break down for supplies / fuel / credits per the hull-tier
// yield table. The MS-parts portion already routed via Issue #64's salvage
// roll at onEnemyDestroyed; this folds in the hull-tier material yields. No
// crew cost.
export function salvageHull(hullId: string): { ok: boolean } {
  const hull = accum.hulls.find((h) => h.id === hullId)
  if (!hull) return { ok: false }
  const tier = tierOf(hull.shipClassId)
  const yld: HullTierSalvageYield | undefined =
    fleetConfig.recoverables.salvageYield[tier]
  if (yld) {
    grantSupplies(yld.supplies)
    grantFuel(yld.fuel)
    creditFleet(yld.credits)
    pushCombatLog(`拆解舰体 · ${hull.nameZh} · +¥${yld.credits}`, 'narr')
  }
  hull.resolution = 'salvage'
  return { ok: true }
}

// Scuttle — leave it. Default on early-close.
export function scuttleHull(hullId: string): { ok: boolean } {
  const hull = accum.hulls.find((h) => h.id === hullId)
  if (!hull) return { ok: false }
  hull.resolution = 'scuttle'
  return { ok: true }
}

// ── Per-pod resolution ─────────────────────────────────────────────────

export function recoverPod(podId: string): { ok: boolean; reasonZh?: string } {
  const pod = accum.pods.find((p) => p.id === podId)
  if (!pod) return { ok: false, reasonZh: '无此逃生舱。' }
  const ok = capturePrisoner({
    id: pod.occupantId,
    nameZh: pod.nameZh,
    titleZh: pod.titleZh,
    contextZh: pod.contextZh,
    factionId: pod.factionId,
  })
  if (!ok) return { ok: false, reasonZh: '禁闭室已满，无法收容。' }
  pod.resolution = 'recover'
  pushCombatLog(`俘获 · ${pod.nameZh}`, 'narr')
  return { ok: true }
}

export function leavePod(podId: string): { ok: boolean } {
  const pod = accum.pods.find((p) => p.id === podId)
  if (!pod) return { ok: false }
  pod.resolution = 'leave'
  return { ok: true }
}

// ── Tally hand-off ─────────────────────────────────────────────────────

// Stash the tally payload endCombat would otherwise emit, then open the
// recoverables dialogue. Returns true when recoverables exist (caller
// should NOT emit the tally — finishRecoverables will).
export function openRecoverablesBeforeTally(tally: CombatTallyEventPayload): boolean {
  if (!hasRecoverables()) return false
  pendingTally = tally
  emitSim('ui:open-recoverables', { hulls: accum.hulls.length, pods: accum.pods.length })
  return true
}

// Resolve any pending entries to their default (scuttle hulls, leave pods),
// then emit the post-combat tally with refreshed brig occupancy (pod
// recoveries may have changed it). Idempotent — a second call no-ops.
export function finishRecoverables(): void {
  for (const h of accum.hulls) if (h.resolution === 'pending') h.resolution = 'scuttle'
  for (const p of accum.pods) if (p.resolution === 'pending') p.resolution = 'leave'
  const tally = pendingTally
  pendingTally = null
  if (!tally) return
  // Refresh brig occupancy + captured rows — pod recoveries landed POWs.
  const refreshed = refreshTallyBrig(tally)
  emitSim('ui:open-combat-tally', refreshed)
}

function refreshTallyBrig(tally: CombatTallyEventPayload): CombatTallyEventPayload {
  const { occupied, capacity } = getBrigOccupancy()
  const capturedPows = useBrig.getState().pendingTally.map((p) => ({
    id: p.id,
    nameZh: p.nameZh,
    titleZh: p.titleZh,
    contextZh: p.contextZh,
  }))
  return { ...tally, brigOccupied: occupied, brigCapacity: capacity, capturedPows }
}

// Salvage credits land in the player faction fund via the player's Money,
// mirroring endCombat's victory reward path.
function creditFleet(amount: number): void {
  if (amount === 0) return
  const player = findPlayerEntity()
  if (!player) return
  const m = player.get(Money) ?? { amount: 0 }
  player.set(Money, { amount: m.amount + amount })
}

// ── Save round-trip + counters ─────────────────────────────────────────

export function getRecoverableCounters(): { hull: number; pod: number } {
  return { hull: hullCounter, pod: podCounter }
}
export function setRecoverableCounters(hull: number, pod: number): void {
  hullCounter = hull
  podCounter = pod
}
