// MS-side stat schema — Phase 6.2.5.A. Mirror of shipSchema.ts.
// Template scalars project here as stat bases at spawn; Effects
// (pilot skills, frame mods) layer on top in future slices.

import { type FormulaTable, identityFormulas, createSheet } from './sheet'

export const MS_STAT_IDS = [
  'hullPoints',
  'armorPoints',
  'topSpeed',
  'maneuverability',
  // Phase 6.2.5.C — sortie resource caps. Stats so frame mods (extended
  // propellant tank, life-support pod) emit Effects against them the
  // same way armor plating emits against armorPoints. Per-sortie current
  // values live on the Ms runtime instance, not on the sheet.
  'propellantStorage',
  'lifeSupportMinutes',
  // Phase 6.2.5.C — bolt-on frame mod budget. Integer-counted ("either
  // it fits or it doesn't" per Design/fleet.md); promoted to a stat so
  // a future "expanded chassis" research line can emit `flat +1` on the
  // sheet without touching template authoring.
  'frameSlots',
  // Phase 6.2.5.C — multiplicative resupply-speed bonus. Frame mods,
  // facility-tier upgrades, and Field Logistics research all stack into
  // this stat; the resupply formula reads it via getStat and applies it
  // as `/ resourceBoostMul`. Base seeds to 1 at spawn so the formula is
  // a no-op without contributors.
  'sortieResupplyMul',
] as const

export type MsStatId = typeof MS_STAT_IDS[number]

export const MS_STAT_FORMULAS: FormulaTable<MsStatId> = identityFormulas(MS_STAT_IDS)

export function createMsSheet(): ReturnType<typeof createSheet<MsStatId>> {
  return createSheet(MS_STAT_IDS, MS_STAT_FORMULAS)
}

export { attachFormulas, serializeSheet } from './sheet'
export type { SerializedSheet } from './sheet'
