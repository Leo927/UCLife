// Ship-side Effect helpers. Mirrors src/ecs/factionEffects.ts for
// ShipEffectsList + ShipStatSheet. The Effect engine itself is shared
// with characters and factions (src/stats/effects.ts) — only the schema
// differs (see src/stats/shipSchema.ts).

import type { Entity } from 'koota'
import { Ship, ShipStatSheet, ShipEffectsList, type ShipStatId } from './traits'
import {
  applyEffectToSheet, removeEffectFromSheet, rebuildSheetFromEffects, type Effect,
} from '../stats/effects'
import { setBase } from '../stats/sheet'
import { createShipSheet } from '../stats/shipSchema'
import { getShipClass, type ShipClassDef } from '../data/ship-classes'

export type ShipEffect = Effect<ShipStatId>

// Idempotent: an existing ShipEffect with the same id is replaced.
// Returns true on success, false if the entity lacks the required traits
// (defensive — the ship spawner attaches both on every Ship).
export function addShipEffect(ship: Entity, effect: ShipEffect): boolean {
  if (!ship.has(ShipStatSheet)) return false
  if (!ship.has(ShipEffectsList)) ship.add(ShipEffectsList)
  const cur = ship.get(ShipEffectsList)!
  const filtered = cur.list.filter((e) => e.id !== effect.id)
  ship.set(ShipEffectsList, { list: [...filtered, effect] })
  const ss = ship.get(ShipStatSheet)!
  ship.set(ShipStatSheet, { sheet: applyEffectToSheet(ss.sheet, effect) })
  return true
}

export function removeShipEffect(ship: Entity, effectId: string): boolean {
  if (!ship.has(ShipEffectsList)) return false
  const cur = ship.get(ShipEffectsList)!
  const next = cur.list.filter((e) => e.id !== effectId)
  if (next.length === cur.list.length) return false
  ship.set(ShipEffectsList, { list: next })
  const ss = ship.get(ShipStatSheet)
  if (ss) ship.set(ShipStatSheet, { sheet: removeEffectFromSheet(ss.sheet, effectId) })
  return true
}

export function getShipEffects(ship: Entity): readonly ShipEffect[] {
  if (!ship.has(ShipEffectsList)) return []
  return ship.get(ShipEffectsList)!.list
}

// Project a ship-class's scalar template fields into a fresh
// ShipStatSheet. Called at ship spawn (bootstrap, future buys at
// 6.2.C1/C2). Pure: returns a sheet with bases set, no Effects applied.
// Effect layering is the caller's job once the ship is alive (officer
// skills, frame mods, damage state, doctrine).
//
// Stats authored on the template (hullMax/armorMax/topSpeed/…) project
// straight onto the matching stat base. Stats not yet on the template
// (supplyPerDay, maneuverability, mechanicCrewSlots, onShipRepairCap,
// onShipRepairFloor, supplyStorage, fuelStorage, hangarCapacity,
// cargoCapacity, dpCost) seed from `extras` overrides — at 6.2.B no
// consumer reads those bases yet, so callers can omit `extras`.
export function projectShipSheet(
  cls: ShipClassDef,
  extras: Partial<Record<ShipStatId, number>> = {},
): ReturnType<typeof createShipSheet> {
  let sheet = createShipSheet()
  sheet = setBase(sheet, 'hullPoints', cls.hullMax)
  sheet = setBase(sheet, 'armorPoints', cls.armorMax)
  sheet = setBase(sheet, 'topSpeed', cls.topSpeed)
  sheet = setBase(sheet, 'crewRequired', cls.crewMax)
  sheet = setBase(sheet, 'brigCapacity', cls.brigCapacity)
  sheet = setBase(sheet, 'fuelStorage', cls.fuelMax)
  sheet = setBase(sheet, 'supplyStorage', cls.suppliesMax)
  // Phase 6.2.F — drain stat. Templates that omit supplyPerDay fold to
  // 0; the daily drain tick skips ships at zero drain (e.g. mothballed
  // or hulls authored without the field yet).
  if (cls.supplyPerDay !== undefined) {
    sheet = setBase(sheet, 'supplyPerDay', cls.supplyPerDay)
  }
  for (const id of Object.keys(extras) as ShipStatId[]) {
    sheet = setBase(sheet, id, extras[id]!)
  }
  return sheet
}

// Attach a fresh ShipStatSheet + ShipEffectsList on a Ship entity. The
// sheet's modifier arrays rebuild from any existing Effects list so a
// post-restore call lands a coherent fold without losing officer /
// frame-mod / damage / doctrine Effects authored before save.
export function attachShipStatSheet(ent: Entity): void {
  const s = ent.get(Ship)
  if (!s) return
  const cls = getShipClass(s.templateId)
  const sheet = projectShipSheet(cls)
  if (!ent.has(ShipStatSheet)) ent.add(ShipStatSheet)
  if (!ent.has(ShipEffectsList)) ent.add(ShipEffectsList)
  const effects = ent.get(ShipEffectsList)!.list
  ent.set(ShipStatSheet, { sheet: rebuildSheetFromEffects(sheet, effects) })
}
