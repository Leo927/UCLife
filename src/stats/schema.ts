// Single source of truth for every StatId the modifier system tracks.
// Modifier sources are namespaced strings (e.g. 'bg:soldier',
// 'perk:long-distance') so the save bundle survives JSON round-trip
// without object-reference plumbing.

import { type FormulaTable, identityFormulas, createSheet } from './sheet'

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

export const SKILL_IDS = [
  'mechanics', 'marksmanship', 'athletics', 'cooking', 'medicine',
  'computers', 'piloting', 'bartending', 'engineering',
] as const
export type SkillStatId = typeof SKILL_IDS[number]

const SKILL_XP_MUL_IDS = SKILL_IDS.map((s) => `${s}XpMul` as const)
type SkillXpMulId = `${SkillStatId}XpMul`

// Economic multipliers — perks and (eventually) gear/conditions push
// percentMult modifiers here. Default base 1 so an unmodified player sees
// listed prices/wages.
export const ECONOMIC_IDS = ['wageMul', 'shopMul', 'rentMul'] as const
export type EconomicStatId = typeof ECONOMIC_IDS[number]

export type StatId =
  | AttributeId
  | VitalMaxId
  | VitalDrainMulId
  | HealthStatId
  | SkillStatId
  | SkillXpMulId
  | EconomicStatId

export const STAT_IDS: readonly StatId[] = [
  ...ATTRIBUTE_IDS,
  ...VITAL_MAX_IDS,
  ...VITAL_DRAIN_MUL_IDS,
  ...HEALTH_IDS,
  ...SKILL_IDS,
  ...SKILL_XP_MUL_IDS,
  ...ECONOMIC_IDS,
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

// Helper for save/load. Re-imports avoid a circular ./sheet → ./schema chain.
export { attachFormulas, serializeSheet } from './sheet'
export type { SerializedSheet } from './sheet'
