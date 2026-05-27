// MS-side stat schema — Phase 6.2.5.A. Mirror of shipSchema.ts.
// Template scalars project here as stat bases at spawn; Effects
// (pilot skills, frame mods) layer on top in future slices.

import { type FormulaTable, identityFormulas, createSheet } from './sheet'

export const MS_STAT_IDS = [
  'hullPoints',
  'armorPoints',
  'topSpeed',
  'maneuverability',
] as const

export type MsStatId = typeof MS_STAT_IDS[number]

export const MS_STAT_FORMULAS: FormulaTable<MsStatId> = identityFormulas(MS_STAT_IDS)

export function createMsSheet(): ReturnType<typeof createSheet<MsStatId>> {
  return createSheet(MS_STAT_IDS, MS_STAT_FORMULAS)
}

export { attachFormulas, serializeSheet } from './sheet'
export type { SerializedSheet } from './sheet'
