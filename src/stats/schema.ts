// Single source of truth for every StatId the modifier system tracks.
// Modifier sources are namespaced strings (e.g. 'bg:soldier',
// 'perk:long-distance') so the save bundle survives JSON round-trip
// without object-reference plumbing.

import { type FormulaTable, identityFormulas, createSheet } from './sheet'
import { SKILL_IDS, type SkillId } from '../config/skills'

// Re-exports — keeps callers' `import { SKILL_IDS, SkillStatId } from
// '../stats/schema'` paths intact. SKILL_IDS lives canonically in
// config/skills.ts (the lowest layer) so config-layer schema files
// can reference SkillId without reaching upward into character/.
export { SKILL_IDS }
export type SkillStatId = SkillId

export const ATTRIBUTE_IDS = [
  'strength', 'endurance', 'charisma', 'intelligence', 'reflex', 'resolve',
] as const
export type AttributeId = typeof ATTRIBUTE_IDS[number]

export const VITAL_IDS = ['hunger', 'thirst', 'fatigue', 'hygiene', 'boredom'] as const
export type VitalId = typeof VITAL_IDS[number]

const VITAL_MAX_IDS = VITAL_IDS.map((v) => `${v}Max` as const)
const VITAL_DRAIN_MUL_IDS = VITAL_IDS.map((v) => `${v}DrainMul` as const)
type VitalMaxId = `${VitalId}Max`
type VitalDrainMulId = `${VitalId}DrainMul`

export const HEALTH_IDS = ['hpMax', 'hpRegenMul'] as const
export type HealthStatId = typeof HEALTH_IDS[number]

const SKILL_XP_MUL_IDS = SKILL_IDS.map((s) => `${s}XpMul` as const)
type SkillXpMulId = `${SkillStatId}XpMul`

// Economic multipliers — perks and (eventually) gear/conditions push
// percentMult modifiers here. Default base 1 so an unmodified player sees
// listed prices/wages.
export const ECONOMIC_IDS = ['wageMul', 'shopMul', 'rentMul'] as const
export type EconomicStatId = typeof ECONOMIC_IDS[number]

// Work performance multiplier. workSystem scales the per-minute
// todayPerf increment by this stat so a flu-stricken player produces
// 0.6× output without the system needing to know about flus. Default
// base 1.0; conditions stack `percentMult` modifiers via the Effects
// layer.
export const WORK_PERF_IDS = ['workPerfMul'] as const
export type WorkPerfStatId = typeof WORK_PERF_IDS[number]

// Per-verb action speed multipliers. The action FSM scales its
// per-tick `remaining`-decrement by the matching speed, so a 0.5
// reads as a limp (action takes 2× as long), 0 as a hard lockout
// (action cannot finish — terminal check never trips). Default base 1
// keeps existing timings intact until a perk or condition stacks a
// modifier. movement.ts reads walkingSpeed on top of statMult(reflex)
// so reflex still drives the natural baseline; the stat captures only
// the modifier layer.
export const VERB_SPEED_IDS = [
  'walkingSpeed',
  'eatingSpeed',
  'sleepingSpeed',
  'washingSpeed',
  'workingSpeed',
  'readingSpeed',
  'drinkingSpeed',
  'revelingSpeed',
  'chattingSpeed',
  'exercisingSpeed',
] as const
export type VerbSpeedId = typeof VERB_SPEED_IDS[number]

export type StatId =
  | AttributeId
  | VitalMaxId
  | VitalDrainMulId
  | HealthStatId
  | SkillStatId
  | SkillXpMulId
  | EconomicStatId
  | WorkPerfStatId
  | VerbSpeedId

export const STAT_IDS: readonly StatId[] = [
  ...ATTRIBUTE_IDS,
  ...VITAL_MAX_IDS,
  ...VITAL_DRAIN_MUL_IDS,
  ...HEALTH_IDS,
  ...SKILL_IDS,
  ...SKILL_XP_MUL_IDS,
  ...ECONOMIC_IDS,
  ...WORK_PERF_IDS,
  ...VERB_SPEED_IDS,
]

export const STAT_FORMULAS: FormulaTable<StatId> = identityFormulas(STAT_IDS)

// Spawn defaults — base values before any modifiers apply. Attributes
// default to 50 (the spawn baseline shared by every character), vital
// maxes to 100 (matches the legacy hardcoded clamp), vital drain
// multipliers to 1 (no scaling), HP max to 100 with neutral regen.
// Skill bases hold raw XP (0 at spawn); their XpMul stats default to 1.
// Economic mul stats (wage/shop/rent) default to 1 (listed price).
export const STAT_DEFAULTS: Partial<Record<StatId, number>> = (() => {
  const out: Partial<Record<StatId, number>> = {}
  for (const id of ATTRIBUTE_IDS) out[id] = 50
  for (const id of VITAL_MAX_IDS) out[id] = 100
  for (const id of VITAL_DRAIN_MUL_IDS) out[id] = 1
  out.hpMax = 100
  out.hpRegenMul = 1
  for (const id of SKILL_IDS) out[id] = 0
  for (const id of SKILL_XP_MUL_IDS) out[id] = 1
  for (const id of ECONOMIC_IDS) out[id] = 1
  for (const id of WORK_PERF_IDS) out[id] = 1
  for (const id of VERB_SPEED_IDS) out[id] = 1
  return out
})()

export function createCharacterSheet(): ReturnType<typeof createSheet<StatId>> {
  return createSheet(STAT_IDS, STAT_FORMULAS, STAT_DEFAULTS)
}

export function vitalMaxStat(v: VitalId): VitalMaxId {
  return `${v}Max`
}
export function vitalDrainMulStat(v: VitalId): VitalDrainMulId {
  return `${v}DrainMul`
}
export function skillXpMulStat(s: SkillStatId): SkillXpMulId {
  return `${s}XpMul`
}

const VERB_SPEED_BY_KIND: Partial<Record<string, VerbSpeedId>> = {
  walking: 'walkingSpeed',
  eating: 'eatingSpeed',
  sleeping: 'sleepingSpeed',
  washing: 'washingSpeed',
  working: 'workingSpeed',
  reading: 'readingSpeed',
  drinking: 'drinkingSpeed',
  reveling: 'revelingSpeed',
  chatting: 'chattingSpeed',
  exercising: 'exercisingSpeed',
}

// Returns null for the action kinds that don't carry a verb-speed stat
// (`idle`). Caller treats null as "no scaling."
export function verbSpeedStat(actionKind: string): VerbSpeedId | null {
  return VERB_SPEED_BY_KIND[actionKind] ?? null
}

// Helper for save/load. Re-imports avoid a circular ./sheet → ./schema chain.
export { attachFormulas, serializeSheet } from './sheet'
export type { SerializedSheet } from './sheet'
