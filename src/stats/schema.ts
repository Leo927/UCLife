// Single source of truth for the per-character stat schema. Every stat the
// modifier system understands lives here; new stats land by extending this
// file plus the associated formula and default below.
//
// Categories:
//   attribute    — slow-drifting RPG stats (strength..resolve). The
//                  attributesSystem drifts each stat's `base` toward a
//                  per-day target derived from recentUse/recentStress.
//   vital max    — per-vital ceiling enforced by vitalsSystem's clamp.
//   vital drain  — per-vital multiplier on outgoing drain (negative deltas
//                  use the authored magnitude — recovery isn't scaled).
//   health       — hpMax + hpRegenMul. Mirrors the vital pattern for HP.
//
// Sources for modifiers are namespaced strings, not object refs, so the
// save bundle stays JSON-clean and removeBySource() has a stable identity
// across reload. Examples: 'background:soldier', 'perk:long-distance',
// 'item:belt'.

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

export type StatId = AttributeId | VitalMaxId | VitalDrainMulId | HealthStatId

export const STAT_IDS: readonly StatId[] = [
  ...ATTRIBUTE_IDS,
  ...VITAL_MAX_IDS,
  ...VITAL_DRAIN_MUL_IDS,
  ...HEALTH_IDS,
]

export const STAT_FORMULAS: FormulaTable<StatId> = identityFormulas(STAT_IDS)

// Spawn defaults — base values before any modifiers apply. Attributes
// default to 50 (the spawn baseline shared by every character), vital
// maxes to 100 (matches the legacy hardcoded clamp), vital drain
// multipliers to 1 (no scaling), HP max to 100 with neutral regen.
export const STAT_DEFAULTS: Partial<Record<StatId, number>> = (() => {
  const out: Partial<Record<StatId, number>> = {}
  for (const id of ATTRIBUTE_IDS) out[id] = 50
  for (const id of VITAL_MAX_IDS) out[id] = 100
  for (const id of VITAL_DRAIN_MUL_IDS) out[id] = 1
  out.hpMax = 100
  out.hpRegenMul = 1
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

// Helper for save/load. Re-imports avoid a circular ./sheet → ./schema chain.
export { attachFormulas, serializeSheet } from './sheet'
export type { SerializedSheet } from './sheet'
