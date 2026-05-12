// Ship-side stat schema. Phase 6.2.B introduces a per-Ship StatSheet
// parallel to per-character (src/stats/schema.ts) and per-faction
// (src/stats/factionSchema.ts). Same engine (src/stats/sheet.ts), same
// Modifier shape — only the list of stat ids and their defaults differ.
//
// The principle from Design/fleet.md: "any number that can change at
// runtime is a stat." Ship-class scalars (hullPoints, armorPoints,
// topSpeed, …) authored on the immutable template project here as the
// stat's `base`. Officer skills, frame mods, damage state, faction
// research, and doctrine stance layer Effects on top.
//
// Default base 0 is intentional — every Ship instance overrides the base
// from its class template at spawn time (see bootstrapShipScene). Stats
// with no consumer at 6.2.B (manoeuvrability, supplyPerDay, supplyStorage,
// fuelStorage, cargoCapacity, hangarCapacity, mechanicCrewSlots,
// onShipRepairCap, onShipRepairFloor, crewRequired, dpCost) are authored
// now so downstream slices (6.2.C through 6.2.G) don't churn the schema.

import { type FormulaTable, identityFormulas, createSheet } from './sheet'

export const SHIP_STAT_IDS = [
  // Combat-relevant maxes — fold into the existing Ship trait runtime mirror
  // at spawn; combat & UI read from the mirror today, will migrate to
  // getStat(sheet, ...) in later slices.
  'hullPoints',
  'armorPoints',
  'topSpeed',
  'maneuverability',
  // Logistics — campaign-map drain + per-ship storage caps (consumed at 6.2.F).
  'supplyPerDay',
  'supplyStorage',
  'fuelStorage',
  'cargoCapacity',
  // Hangar / forward-repair (consumed at 6.2.C2 + 6.2.5).
  'hangarCapacity',
  'mechanicCrewSlots',
  'onShipRepairCap',
  'onShipRepairFloor',
  // Crew + roles.
  'crewRequired',
  'brigCapacity',
  'dpCost',
] as const

export type ShipStatId = typeof SHIP_STAT_IDS[number]

export const SHIP_STAT_FORMULAS: FormulaTable<ShipStatId> = identityFormulas(SHIP_STAT_IDS)

// Bases all default to 0. Spawn-time projection from the ship template
// overrides every value the template authors (see ecs/spawn.ts).
export function createShipSheet(): ReturnType<typeof createSheet<ShipStatId>> {
  return createSheet(SHIP_STAT_IDS, SHIP_STAT_FORMULAS)
}

export { attachFormulas, serializeSheet } from './sheet'
export type { SerializedSheet } from './sheet'
