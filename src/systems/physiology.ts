// Phase 4.0 — physiology phase machine + banded reconciler.
//
// Driven by 'day:rollover' (one tick per game-day). Reads templates
// from src/character/conditions.ts and writes ConditionInstance state
// onto the per-character Conditions trait. Each band emits an Effect
// onto the character's Effects trait, keyed cond:<instanceId>:b<n>.
// Per-tick code never touches conditions — the StatSheet fold via
// getStat() is the only read path.
//
// Design refs:
//   Design/characters/physiology.md (lifecycle + recovery formula)
//   Design/characters/physiology-data.md (instance shape)
//   Design/characters/effects.md (banded reconciler + fold cadence)

import type { World, Entity } from 'koota'
import {
  Character, Conditions, IsPlayer, EntityKey, Health,
  type ConditionInstance,
} from '../ecs/traits'
import {
  getConditionTemplate, severityTier, CONDITIONS,
  type ConditionTemplate, type OnsetPath,
} from '../character/conditions'
import { addEffect, removeEffect } from '../character/effects'
import { SeededRng } from '../procgen/rng'
import { emitSim } from '../sim/events'
import { statValue } from './attributes'

// Treatment-tier tables from physiology.md § Treatment options.
//   Untreated / pharmacy / clinic
const PEAK_REDUCTION_BY_TIER = [0, 15, 25] as const
const RECOVERY_MUL_BY_TIER = [1.0, 1.5, 2.0] as const

// ──────────────────────────────────────────────────────────────────────
// RNG — deterministic per (entity, day, purpose) so onset rolls
// reproduce when re-running a scenario from a save.
// ──────────────────────────────────────────────────────────────────────
function rngFor(entity: Entity, dayNumber: number, purpose: string): SeededRng {
  const key = entity.get(EntityKey)
  const seed = key ? key.key : String(entity)
  return SeededRng.fromString(`physiology:${seed}:${dayNumber}:${purpose}`)
}

function rollFromRange(rng: SeededRng, range: [number, number] | number): number {
  if (typeof range === 'number') return range
  const [min, max] = range
  if (min === max) return min
  return min + Math.floor(rng.uniform() * (max - min + 1))
}

// ──────────────────────────────────────────────────────────────────────
// Onset — instantiate a fresh ConditionInstance from a template and
// attach its bands to the character.
// ──────────────────────────────────────────────────────────────────────
let nextInstanceCounter = 0
function freshInstanceId(templateId: string): string {
  // Short, sortable, collision-resistant. Counter alone is fine here —
  // instances live on a single in-process world and never cross-merge.
  return `c-${templateId}-${++nextInstanceCounter}-${Math.random().toString(36).slice(2, 6)}`
}

export function spawnConditionInstance(
  template: ConditionTemplate,
  rng: SeededRng,
  onsetDay: number,
  source: string,
): ConditionInstance {
  return {
    instanceId: freshInstanceId(template.id),
    templateId: template.id,
    phase: 'incubating',
    severity: 0,
    peakTracking: 0,
    bodyPart: null,
    onsetDay,
    incubationDays: rollFromRange(rng, template.incubationDays),
    riseDays: rollFromRange(rng, template.riseDays),
    peakSeverity: rollFromRange(rng, template.peakSeverity),
    peakDays: rollFromRange(rng, template.peakDays),
    peakDayCounter: 0,
    source,
    diagnosed: false,
    diagnosedDay: null,
    currentTreatmentTier: 0,
    treatmentExpiresDay: null,
    activeBands: [],
    lastDigestDay: 0,
  }
}

// Returns the new instance, or null if onset was rejected (template
// missing, or character already carries an instance of this template
// at the same body part — design rule, physiology-data.md §
// Stacking is upstream's job).
export function onsetCondition(
  entity: Entity,
  templateId: string,
  source: string,
  dayNumber: number,
  rng: SeededRng,
): ConditionInstance | null {
  const template = getConditionTemplate(templateId)
  if (!template) return null
  if (!entity.has(Conditions)) entity.add(Conditions)
  const cond = entity.get(Conditions)!
  // Stacking rule: at most one instance per (templateId, bodyPart). For
  // Phase 4.0 templates are systemic, so this is just a templateId check.
  for (const inst of cond.list) {
    if (inst.templateId === templateId && inst.bodyPart === null) return null
  }
  const instance = spawnConditionInstance(template, rng, dayNumber, source)
  entity.set(Conditions, { list: [...cond.list, instance] })
  // Initial band reconcile — at severity 0 only [0,0] bands are active,
  // but reconciler is the same path so we use it for symmetry.
  reconcileBands(entity, instance, template)
  // Player-only side effects.
  if (entity.has(IsPlayer)) {
    const onset = template.eventLogTemplates.onset
    if (onset) emitSim('toast', { textZh: onset, durationMs: 5000 })
    if (onset) emitSim('log', { textZh: onset, atMs: Date.now() })
  } else {
    const ch = entity.get(Character)
    if (ch?.name && template.eventLogTemplates.onset) {
      emitSim('log', {
        textZh: `${ch.name}${template.eventLogTemplates.onset.replace('你', '')}`,
        atMs: Date.now(),
      })
    }
  }
  return instance
}

// ──────────────────────────────────────────────────────────────────────
// Banded reconciler — diff the prev/next active band sets on every
// severity change and emit add/remove ops on the Effects trait.
// ──────────────────────────────────────────────────────────────────────
function activeBandIndices(template: ConditionTemplate, severity: number): number[] {
  const out: number[] = []
  for (let i = 0; i < template.effects.length; i++) {
    const [lo, hi] = template.effects[i].severityRange
    if (severity >= lo && severity <= hi) out.push(i)
  }
  return out
}

function bandEffectId(instanceId: string, bandIndex: number): string {
  return `cond:${instanceId}:b${bandIndex}`
}

function reconcileBands(
  entity: Entity,
  instance: ConditionInstance,
  template: ConditionTemplate,
): void {
  const next = activeBandIndices(template, instance.severity)
  const prev = instance.activeBands
  // Remove bands that fell out.
  for (const idx of prev) {
    if (!next.includes(idx)) removeEffect(entity, bandEffectId(instance.instanceId, idx))
  }
  // Add bands that came in.
  for (const idx of next) {
    if (prev.includes(idx)) continue
    const band = template.effects[idx]
    addEffect(entity, {
      id: bandEffectId(instance.instanceId, idx),
      originId: instance.instanceId,
      family: 'condition',
      modifiers: band.modifiers.map((m) => ({ statId: m.statId, type: m.type, value: m.value })),
      nameZh: band.nameZh,
      flavorZh: band.flavorZh,
      glyphRef: band.glyphRef,
      // Player undiagnosed conditions render anonymized via this flag.
      hidden: entity.has(IsPlayer) && !instance.diagnosed,
      startedDay: instance.onsetDay,
    })
  }
  instance.activeBands = next
}

// Tear-down — remove every band Effect for this instance. Used on
// resolve and on instance destruction (e.g., near-death respawn).
function tearDownBands(entity: Entity, instance: ConditionInstance): void {
  for (const idx of instance.activeBands) {
    removeEffect(entity, bandEffectId(instance.instanceId, idx))
  }
  instance.activeBands = []
}

// ──────────────────────────────────────────────────────────────────────
// Recovery formula — physiology.md § Severity update, recovering arm.
// ──────────────────────────────────────────────────────────────────────
function recoveryRate(
  template: ConditionTemplate,
  instance: ConditionInstance,
  enduranceValue: number,
): number {
  // Endurance 0..100 → 0.5×..1.5× recovery scalar.
  const enduranceMul = 0.5 + (Math.max(0, Math.min(100, enduranceValue)) / 100)
  const tierMul = RECOVERY_MUL_BY_TIER[
    Math.max(0, Math.min(RECOVERY_MUL_BY_TIER.length - 1, instance.currentTreatmentTier))
  ]
  // High severity recovers slower — mirrors physiology.md formula.
  const severityFactor = 1.0 - instance.severity / 100
  return template.baseRecoveryRate * enduranceMul * tierMul * severityFactor
}

// ──────────────────────────────────────────────────────────────────────
// Per-day phase tick — advance one ConditionInstance one game-day and
// reconcile its bands. Returns true if the instance has resolved (and
// should be removed from the list).
// ──────────────────────────────────────────────────────────────────────
function advanceInstance(
  entity: Entity,
  instance: ConditionInstance,
  template: ConditionTemplate,
  dayNumber: number,
): boolean {
  if (instance.phase === 'incubating') {
    if (dayNumber - instance.onsetDay >= instance.incubationDays) {
      instance.phase = 'rising'
    }
  } else if (instance.phase === 'rising') {
    const peakReduction = PEAK_REDUCTION_BY_TIER[
      Math.max(0, Math.min(PEAK_REDUCTION_BY_TIER.length - 1, instance.currentTreatmentTier))
    ]
    let effectivePeak = instance.peakSeverity - peakReduction
    if (effectivePeak < template.peakSeverityFloor) effectivePeak = template.peakSeverityFloor
    if (instance.riseDays > 0) {
      instance.severity += instance.peakSeverity / instance.riseDays
    } else {
      instance.severity = effectivePeak
    }
    if (instance.severity >= effectivePeak) {
      instance.severity = effectivePeak
      instance.phase = 'peak'
      instance.peakDayCounter = 0
    }
  } else if (instance.phase === 'peak') {
    instance.peakDayCounter += 1
    if (instance.peakDayCounter >= instance.peakDays) {
      instance.phase = instance.currentTreatmentTier >= template.requiredTreatmentTier
        ? 'recovering'
        : 'stalled'
      // Player-visible signal that treatment is needed for the stalled
      // case — the badge logic in the UI reads off `phase === 'stalled'`.
      if (instance.phase === 'stalled' && entity.has(IsPlayer)) {
        const stalled = template.eventLogTemplates.stalled
        if (stalled) {
          emitSim('toast', { textZh: stalled, durationMs: 7000 })
          emitSim('log', { textZh: stalled, atMs: Date.now() })
        }
      }
    }
  } else if (instance.phase === 'recovering') {
    const endurance = statValue(entity, 'endurance')
    instance.severity = Math.max(0, instance.severity - recoveryRate(template, instance, endurance))
    if (instance.currentTreatmentTier < template.requiredTreatmentTier) {
      instance.phase = 'stalled'
    } else if (instance.severity <= 0) {
      // Resolve clean.
      tearDownBands(entity, instance)
      if (entity.has(IsPlayer)) {
        const recovered = template.eventLogTemplates.recoveryClean
        if (recovered) emitSim('log', { textZh: recovered, atMs: Date.now() })
      }
      return true
    }
  } else if (instance.phase === 'stalled') {
    // Severity holds; treatment upgrade flips back to recovering.
    if (instance.currentTreatmentTier >= template.requiredTreatmentTier) {
      instance.phase = 'recovering'
    }
  }

  if (instance.severity > instance.peakTracking) instance.peakTracking = instance.severity
  reconcileBands(entity, instance, template)
  return false
}

// ──────────────────────────────────────────────────────────────────────
// Daily digest — one log line per active condition, emitted once per
// game-day for the player so the event-log carries the recovery story
// without spamming on every band crossing.
// ──────────────────────────────────────────────────────────────────────
function emitDailyDigest(entity: Entity, instance: ConditionInstance, template: ConditionTemplate, dayNumber: number): void {
  if (!entity.has(IsPlayer)) return
  if (instance.phase === 'incubating') return
  if (instance.lastDigestDay === dayNumber) return
  instance.lastDigestDay = dayNumber
  const tier = severityTier(instance.severity)
  const tierZh = tier === 'severe' ? '严重' : tier === 'moderate' ? '中等' : '轻微'
  const name = instance.diagnosed ? template.displayName : '某种疾病'
  const phaseZh =
    instance.phase === 'rising' ? '正在加重' :
    instance.phase === 'peak' ? '处于高峰' :
    instance.phase === 'recovering' ? '正在好转' :
    instance.phase === 'stalled' ? '未见好转' : '潜伏'
  const tail = instance.phase === 'stalled' ? ' — 需要药店或诊所介入' : ''
  emitSim('log', {
    textZh: `${name} — ${tierZh}（${Math.round(instance.severity)}，${phaseZh}）${tail}`,
    atMs: Date.now(),
  })
}

// ──────────────────────────────────────────────────────────────────────
// Per-day system entry — called from the day:rollover binding.
// ──────────────────────────────────────────────────────────────────────
export function physiologySystem(world: World, dayNumber: number): void {
  for (const entity of world.query(Conditions, Health)) {
    const h = entity.get(Health)
    if (h?.dead) continue
    const cond = entity.get(Conditions)!
    if (cond.list.length === 0) continue
    // Mutate copies, not the live instances, so we can write the new
    // list back atomically. Each instance is a small POJO so the copy
    // is cheap.
    const next: ConditionInstance[] = []
    for (const live of cond.list) {
      const inst: ConditionInstance = { ...live, activeBands: [...live.activeBands] }
      const template = getConditionTemplate(inst.templateId)
      if (!template) {
        // Tombstoned id; tear down bands and drop. (Shouldn't happen in
        // 4.0 — included so the assumption is enforced rather than
        // implicit.)
        tearDownBands(entity, inst)
        continue
      }
      const resolved = advanceInstance(entity, inst, template, dayNumber)
      if (!resolved) {
        emitDailyDigest(entity, inst, template, dayNumber)
        next.push(inst)
      }
    }
    if (next.length !== cond.list.length || next.some((n, i) => n !== cond.list[i])) {
      entity.set(Conditions, { list: next })
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// Onset-path helpers for upstream systems (vitalsSystem, actionSystem).
// Each helper is a one-line filter: "is this template eligible for path
// X" — the system that owns the cause then rolls a probability and
// calls onsetCondition().
// ──────────────────────────────────────────────────────────────────────
export function templatesForOnsetPath(path: OnsetPath): readonly ConditionTemplate[] {
  // Linear over the (small) catalog; cache later if the catalog grows.
  const out: ConditionTemplate[] = []
  for (const t of CONDITIONS) {
    if (t.onsetPaths.includes(path)) out.push(t)
  }
  return out
}

// ──────────────────────────────────────────────────────────────────────
// Diagnosis flow — flips the player's instance to diagnosed and bumps
// the band Effects' `hidden` flag so the UI reveals the canonical name.
// ──────────────────────────────────────────────────────────────────────
export function diagnoseCondition(
  entity: Entity,
  instanceId: string,
  dayNumber: number,
): boolean {
  if (!entity.has(Conditions)) return false
  const cond = entity.get(Conditions)!
  let touched = false
  const next = cond.list.map((live) => {
    if (live.instanceId !== instanceId || live.diagnosed) return live
    const inst = { ...live, activeBands: [...live.activeBands], diagnosed: true, diagnosedDay: dayNumber }
    touched = true
    // Re-emit each active band with hidden=false. We re-walk the
    // reconciler so the StatSheet rebuilds as it would for any band
    // change.
    const template = getConditionTemplate(inst.templateId)
    if (template) {
      // Force reconcile by clearing activeBands first so every active
      // band re-adds with the new hidden flag.
      const carried = inst.activeBands
      inst.activeBands = []
      for (const idx of carried) removeEffect(entity, bandEffectId(inst.instanceId, idx))
      reconcileBands(entity, inst, template)
      if (entity.has(IsPlayer)) {
        const dx = template.eventLogTemplates.diagnosis
        if (dx) emitSim('log', { textZh: dx, atMs: Date.now() })
      }
    }
    return inst
  })
  if (touched) entity.set(Conditions, { list: next })
  return touched
}

// ──────────────────────────────────────────────────────────────────────
// Treatment commit — set treatment tier and (optionally) expiry day.
// Untreated → pharmacy → clinic. The phase tick reads
// currentTreatmentTier on the next rollover.
// ──────────────────────────────────────────────────────────────────────
export function commitTreatment(
  entity: Entity,
  instanceId: string,
  tier: number,
  expiresDay: number | null,
): boolean {
  if (!entity.has(Conditions)) return false
  const cond = entity.get(Conditions)!
  let touched = false
  const next = cond.list.map((live) => {
    if (live.instanceId !== instanceId) return live
    const inst = { ...live, activeBands: [...live.activeBands], currentTreatmentTier: tier, treatmentExpiresDay: expiresDay }
    // If the instance was stalled, the next tick will flip it to
    // recovering; if it was already recovering, the tier multiplier
    // takes effect on the next tick. No work needed here beyond the
    // assignment.
    touched = true
    return inst
  })
  if (touched) entity.set(Conditions, { list: next })
  return touched
}

// Test/debug-only: force-onset a condition immediately, regardless of
// path eligibility. Used by smoke tests + the debug handle.
export function forceOnset(
  entity: Entity,
  templateId: string,
  source: string,
  dayNumber: number,
): ConditionInstance | null {
  const rng = rngFor(entity, dayNumber, `force:${templateId}`)
  return onsetCondition(entity, templateId, source, dayNumber, rng)
}

// Exposed for the day-rollover binding so it can fan onset rolls
// through paths without importing the system internals scattered.
export { rngFor }
