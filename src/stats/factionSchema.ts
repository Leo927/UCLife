// Faction-side stat schema. Phase 5.5.6 introduces a per-Faction StatSheet
// parallel to the per-character one. Same engine (src/stats/sheet.ts), same
// Modifier shape — only the list of stat ids and their defaults differ.
//
// Faction stats are all multiplicative knobs that fold through existing
// daily-economics / research / recruitment / housing-pressure formulas.
// Default base 1.0 keeps every consumer reading the same baseline as the
// pre-5.5.6 hard-coded value when no FactionEffect has applied yet.

import { type FormulaTable, identityFormulas, createSheet } from './sheet'

export const FACTION_STAT_IDS = [
  // dailyEconomics revenue per worked job site (Phase 5.5.6 → migrates the
  // per-faction config knob into a sheet base + modifier channel).
  'revenueMul',
  // dailyEconomics salary multiplier — reserved slot, no consumer wired in
  // 5.5.6.
  'salaryMul',
  // dailyEconomics maintenance multiplier — reserved slot, no consumer
  // wired in 5.5.6.
  'maintenanceMul',
  // researchSystem progress per shift × this. The first faction stat with
  // a live consumer.
  'researchSpeedMul',
  // recruitmentSystem applicant chance × this — reserved slot, no consumer
  // wired in 5.5.6.
  'recruitChanceMul',
  // housingPressureSystem + on-job loyalty drift × this — reserved slot,
  // no consumer wired in 5.5.6.
  'loyaltyDriftMul',
] as const

export type FactionStatId = typeof FACTION_STAT_IDS[number]

export const FACTION_STAT_DEFAULTS: Partial<Record<FactionStatId, number>> = (() => {
  const out: Partial<Record<FactionStatId, number>> = {}
  for (const id of FACTION_STAT_IDS) out[id] = 1.0
  return out
})()

export const FACTION_STAT_FORMULAS: FormulaTable<FactionStatId> = identityFormulas(FACTION_STAT_IDS)

export function createFactionSheet(): ReturnType<typeof createSheet<FactionStatId>> {
  return createSheet(FACTION_STAT_IDS, FACTION_STAT_FORMULAS, FACTION_STAT_DEFAULTS)
}

export { attachFormulas, serializeSheet } from './sheet'
export type { SerializedSheet } from './sheet'
