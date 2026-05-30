// Issue #70 — prisoner system. The single implementation of the brig
// per-prisoner verbs (interrogate / ransom / recruit / execute / hand-over
// / release) plus the in-flight brig-condition upkeep tick. Both the brig
// walk-up (BrigPanel) and the captain's-office comm-panel face wall
// (CommPanelDialog) route through here — one source of truth.
//
// Faction asymmetries are DATA: the rep deltas (and the per-faction
// `approval` overrides — e.g. Zeon hardliners approving an execution) come
// from src/config/prisoners.json5. This module never branches on a faction
// id.
//
// Brig-condition upkeep reuses the physiology pipeline: each prisoner is a
// real Character entity in playerShipInterior carrying the Conditions
// trait. When provisioning falls below the floor the brig tick onsets the
// `brig_neglect` condition via the shared `forceOnset`; the day-rollover
// physiologySystem then advances it to the fatal peak and flags
// Health.dead — the same lifecycle + death machinery every other condition
// uses. No second decay engine.

import type { Entity } from 'koota'
import {
  Character, Health, Conditions, EntityKey, IsPlayer, Money,
} from '../ecs/traits'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { spawnNPC } from '../character/spawn'
import { forceOnset } from './physiology'
import { addRep, getRep } from './reputation'
import { statValue } from './attributes'
import { useBrig, getBrigCapacity, type PrisonerRecord } from '../sim/brig'
import { getSimRng } from '../sim/rng'
import { simNow } from '../sim/time'
import { emitSim } from '../sim/events'
import { useClock, gameDayNumber } from '../sim/clock'
import { factionsConfig, prisonersConfig } from '../config'
import type { FactionId } from '../data/factions'
import type { PrisonerVerbOutcome } from '../config/prisoners'

const SHIP_SCENE_ID = 'playerShipInterior'

const ALL_FACTION_IDS = Object.keys(factionsConfig.catalog) as FactionId[]

// ── Player + prisoner-entity lookup ────────────────────────────────────

function findPlayer(): Entity | undefined {
  for (const id of SCENE_IDS) {
    const e = getWorld(id).queryFirst(IsPlayer)
    if (e) return e
  }
  return undefined
}

function findPrisonerEntity(entityKey: string): Entity | undefined {
  if (!entityKey) return undefined
  const w = getWorld(SHIP_SCENE_ID)
  for (const e of w.query(Character, EntityKey)) {
    if (e.get(EntityKey)!.key === entityKey) return e
  }
  return undefined
}

// ── Reputation application (faction asymmetries are data) ──────────────

// Apply one verb's authored outcome against the player's Reputation. The
// home faction reads `approval[homeFaction] ?? homeDelta`; the player's
// own faction reads `captorDelta`; every OTHER known faction reads
// `broadDelta`. Returns the per-faction delta map actually applied (for
// UI / test assertions).
function applyOutcome(
  outcome: PrisonerVerbOutcome,
  homeFaction: FactionId,
): Record<string, number> {
  const player = findPlayer()
  if (!player) return {}
  const applied: Record<string, number> = {}

  const homeDelta = outcome.approval[homeFaction] ?? outcome.homeDelta
  if (homeDelta !== 0) {
    addRep(player, homeFaction, homeDelta)
    applied[homeFaction] = homeDelta
  }
  if (outcome.captorDelta !== 0 && homeFaction !== 'player') {
    addRep(player, 'player', outcome.captorDelta)
    applied.player = (applied.player ?? 0) + outcome.captorDelta
  }
  if (outcome.broadDelta !== 0) {
    for (const f of ALL_FACTION_IDS) {
      if (f === homeFaction || f === 'player' || f === 'civilian') continue
      addRep(player, f, outcome.broadDelta)
      applied[f] = (applied[f] ?? 0) + outcome.broadDelta
    }
  }
  return applied
}

// ── Prisoner-entity spawn (Character entity in playerShipInterior) ─────

// Spawn the prisoner's backing Character entity so the shared physiology
// pipeline can tick brig conditions on it. Idempotent on the key — a
// re-spawn (e.g. capture path called twice) returns the existing entity.
export function spawnPrisonerEntity(rec: {
  id: string
  nameZh: string
  factionId: string
}): string {
  const entityKey = `pow-${rec.id}`
  const existing = findPrisonerEntity(entityKey)
  if (existing) return entityKey
  const w = getWorld(SHIP_SCENE_ID)
  const faction = (ALL_FACTION_IDS as string[]).includes(rec.factionId)
    ? (rec.factionId as FactionId)
    : 'pirate'
  spawnNPC(w, {
    name: rec.nameZh,
    color: '#9ca3af',
    title: '战俘',
    x: 0,
    y: 0,
    key: entityKey,
    factionRole: { faction, role: 'staff' },
  })
  return entityKey
}

function destroyPrisonerEntity(entityKey: string): void {
  const ent = findPrisonerEntity(entityKey)
  if (ent) ent.destroy()
}

// Capture one prisoner into the brig: spawn the backing Character entity
// (so the shared physiology pipeline can tick brig conditions on it) and
// add the record to the store. Returns true if the brig had a free slot.
// The single capture path for named-hostile combat capture (#70) AND
// recoverables pod recovery (#71). `provision` seeds the brig-condition
// upkeep at the configured start level.
export function capturePrisoner(spec: {
  id: string
  nameZh: string
  titleZh?: string
  contextZh: string
  factionId: string
}): boolean {
  const entityKey = spawnPrisonerEntity(spec)
  const ok = useBrig.getState().add({
    id: spec.id,
    nameZh: spec.nameZh,
    titleZh: spec.titleZh,
    contextZh: spec.contextZh,
    factionId: spec.factionId,
    capturedAtMs: simNow(),
    entityKey,
    provision: prisonersConfig.provisionStart,
  })
  // Brig refused (full / duplicate) — drop the orphaned entity.
  if (!ok) destroyPrisonerEntity(entityKey)
  return ok
}

// ── Verb resolution ────────────────────────────────────────────────────

export interface VerbResult {
  ok: boolean
  reasonZh?: string
  // Per-faction rep deltas applied this verb (for UI / smoke assertions).
  repDeltas: Record<string, number>
  // Credits credited to the player (ransom / hand-over); 0 otherwise.
  creditsDelta: number
  // Interrogation intel tier, set only by interrogate.
  intelTier?: 'full' | 'partial' | 'none'
}

const NO_RESULT: VerbResult = { ok: false, repDeltas: {}, creditsDelta: 0 }

function getPrisoner(id: string): PrisonerRecord | undefined {
  return useBrig.getState().prisoners.find((p) => p.id === id)
}

function creditPlayer(amount: number): void {
  if (amount === 0) return
  const player = findPlayer()
  if (!player) return
  const m = player.get(Money) ?? { amount: 0 }
  player.set(Money, { amount: m.amount + amount })
}

// Interrogate — extract intel via an Intelligence + Charisma check on the
// player. Above the full threshold yields full intel; above the partial
// threshold yields partial; below yields nothing. The prisoner stays in
// the brig (interrogation is repeatable in principle; here it resolves the
// rep signal once and leaves the captive). Returns the intel tier.
export function interrogatePrisoner(id: string): VerbResult {
  const p = getPrisoner(id)
  if (!p) return NO_RESULT
  const player = findPlayer()
  const score = player
    ? statValue(player, 'intelligence') + statValue(player, 'charisma')
    : 0
  let intelTier: 'full' | 'partial' | 'none' = 'none'
  if (score >= prisonersConfig.interrogateThresholdFull) intelTier = 'full'
  else if (score >= prisonersConfig.interrogateThresholdPartial) intelTier = 'partial'

  const repDeltas = applyOutcome(prisonersConfig.verbs.interrogate, p.factionId as FactionId)
  emitSim('log', { textZh: `审讯 · ${p.nameZh} · ${intelLabel(intelTier)}`, atMs: simNow() })
  return { ok: true, repDeltas, creditsDelta: 0, intelTier }
}

function intelLabel(tier: 'full' | 'partial' | 'none'): string {
  if (tier === 'full') return '获取完整情报'
  if (tier === 'partial') return '获取零散情报'
  return '一无所获'
}

// Ransom — return to the home faction for credits + small rep both sides.
// Frees the brig slot (the design's "frees at next dock" simplifies to
// immediate slot-free here; the credit lands now).
export function ransomPrisoner(id: string): VerbResult {
  const p = getPrisoner(id)
  if (!p) return NO_RESULT
  const repDeltas = applyOutcome(prisonersConfig.verbs.ransom, p.factionId as FactionId)
  const credits = prisonersConfig.ransomCreditsBase
  creditPlayer(credits)
  resolveOut(p, '索赎')
  return { ok: true, repDeltas, creditsDelta: credits }
}

// Whether the recruit verb is offered for a prisoner — gated on the
// prisoner's home-faction loyalty being at or below the configured
// ceiling. Read by the verb wall to show / hide the button.
export function canRecruitPrisoner(id: string): boolean {
  const p = getPrisoner(id)
  if (!p) return false
  const player = findPlayer()
  const homeRep = player ? getRep(player, p.factionId as FactionId) : 0
  return homeRep <= prisonersConfig.maxHomeRepToRecruit
}

// Recruit — convert to crew. Gated to prisoners with low home-faction
// loyalty (a fiercely loyal captive can't be flipped). High loyalty cost
// captured as the home-faction rep penalty in the verb data.
export function recruitPrisoner(id: string): VerbResult {
  const p = getPrisoner(id)
  if (!p) return NO_RESULT
  const player = findPlayer()
  const homeRep = player ? getRep(player, p.factionId as FactionId) : 0
  if (homeRep > prisonersConfig.maxHomeRepToRecruit) {
    return { ...NO_RESULT, reasonZh: '该俘虏对原势力忠诚度过高，无法策反。' }
  }
  const repDeltas = applyOutcome(prisonersConfig.verbs.recruit, p.factionId as FactionId)
  resolveOut(p, '招募')
  return { ok: true, repDeltas, creditsDelta: 0 }
}

// Execute — instant resolve; major rep penalty across most factions, with
// the faction-specific approval asymmetry (Zeon) applied as data.
export function executePrisoner(id: string): VerbResult {
  const p = getPrisoner(id)
  if (!p) return NO_RESULT
  const repDeltas = applyOutcome(prisonersConfig.verbs.execute, p.factionId as FactionId)
  resolveOut(p, '处决')
  return { ok: true, repDeltas, creditsDelta: 0 }
}

// Hand over to a third party — pays out per faction relations.
export function handOverPrisoner(id: string): VerbResult {
  const p = getPrisoner(id)
  if (!p) return NO_RESULT
  const repDeltas = applyOutcome(prisonersConfig.verbs.handOver, p.factionId as FactionId)
  const credits = prisonersConfig.handOverCredits
  creditPlayer(credits)
  resolveOut(p, '移交')
  return { ok: true, repDeltas, creditsDelta: credits }
}

// Release at the next colony — small positive with the home faction.
export function releasePrisoner(id: string): VerbResult {
  const p = getPrisoner(id)
  if (!p) return NO_RESULT
  const repDeltas = applyOutcome(prisonersConfig.verbs.release, p.factionId as FactionId)
  resolveOut(p, '释放')
  return { ok: true, repDeltas, creditsDelta: 0 }
}

// Shared exit path: remove from the brig store, destroy the backing
// Character entity, log the resolution.
function resolveOut(p: PrisonerRecord, verbZh: string): void {
  useBrig.getState().removeById(p.id)
  destroyPrisonerEntity(p.entityKey)
  emitSim('log', { textZh: `${verbZh} · ${p.nameZh}`, atMs: simNow() })
}

// ── In-flight brig-condition upkeep tick ───────────────────────────────
//
// One pass per game-day. For each prisoner:
//   1. If the backing entity is flagged dead (the shared physiology death
//      gate fired on brig_neglect), resolve the death: free the slot,
//      destroy the entity, apply the neglect rep penalty (same pattern as
//      execute — the home faction can't tell starvation from murder).
//   2. Otherwise decay provisioning; below the floor, onset / sustain the
//      brig_neglect condition on the entity so the shared physiologySystem
//      advances it toward the fatal peak.
//   3. Over-capacity prisoners (held in less-secure quarters) roll an
//      escape attempt; on hit the slot frees with no rep payout.
//
// Perf: O(prisoners). Prisoner count is bounded by brigCapacity (≤ 24 on a
// Pegasus) plus a small over-capacity tail — trivially sub-budget, well
// inside the day-rollover chain that already walks every ship + NPC.
export function brigConditionTick(dayNumber: number): void {
  const prisoners = useBrig.getState().prisoners.slice()
  if (prisoners.length === 0) return
  const cap = getBrigCapacity()
  const rng = getSimRng()
  const cfg = prisonersConfig

  prisoners.forEach((p, idx) => {
    // 1. Death detection — the shared physiology pipeline owns the kill.
    const ent = findPrisonerEntity(p.entityKey)
    if (ent) {
      const h = ent.get(Health)
      if (h?.dead) {
        const repDeltas = applyOutcome(cfg.neglectDeath, p.factionId as FactionId)
        void repDeltas
        useBrig.getState().removeById(p.id)
        ent.destroy()
        emitSim('log', { textZh: `${p.nameZh}死于禁闭室的疏于看管。`, atMs: simNow() })
        return
      }
    }

    // 3. Over-capacity escape risk (less-secure quarters).
    if (idx >= cap && rng.next() < cfg.escapeAttemptChancePerDay) {
      useBrig.getState().removeById(p.id)
      destroyPrisonerEntity(p.entityKey)
      emitSim('log', { textZh: `${p.nameZh}从临时关押处逃脱。`, atMs: simNow() })
      return
    }

    // 2. Provisioning decay + neglect onset via the shared pipeline.
    const nextProvision = Math.max(0, p.provision - cfg.provisionDecayPerDay)
    useBrig.getState().setProvision(p.id, nextProvision)
    if (nextProvision <= cfg.provisionFloor && ent) {
      const cond = ent.get(Conditions)
      const alreadyNeglected = cond?.list.some((c) => c.templateId === cfg.neglectConditionId)
      if (!alreadyNeglected) {
        forceOnset(ent, cfg.neglectConditionId, '禁闭室疏于看管', dayNumber)
      }
    }
  })
}

// Test / debug entry: advance one brig-condition tick at the current day.
export function tickBrigConditionsNow(): void {
  brigConditionTick(gameDayNumber(useClock.getState().gameDate))
}
