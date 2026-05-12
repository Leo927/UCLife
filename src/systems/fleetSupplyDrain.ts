// Phase 6.2.F daily aggregate supply drain. Per Design/fleet.md:
//
//   fleetSupplyPerDay =
//       sum(ship.template.supplyPerDay for each non-mothballed ship)
//     + sum(ms.template.supplyPerDay for each MS in any non-mothballed hangar)
//     + sum(ms.template.supplyPerRepairDay for each MS in repair)
//     + crewUpkeepPerDay
//
// 6.2.F lands the *ship-tier* term only; MS terms land at 6.2.5 and
// crewUpkeep at 6.2.D/H. The drain debits the supply reserve on the
// hangar matching each ship's `dockedAtPoiId`. Caps at zero — running
// dry surfaces in the manager dialog (缺补给) and as a HUD gauge tint
// without breaking the tick.
//
// Multi-world iteration: hangars live in city / drydock worlds; ships
// live in playerShipInterior (and, post-6.2.E2, possibly elsewhere).
// The caller (boot/fleetSupplyTick.ts) hands in both worlds so this
// module stays decoupled from getWorld() — easier to unit-test in
// isolation, and the test seeds one koota world for both roles since
// nothing reads the world ids on this path.

import type { Entity, World } from 'koota'
import {
  Building, Hangar, EntityKey, Ship, ShipStatSheet,
} from '../ecs/traits'
import { POIS } from '../data/pois'
import { getStat } from '../stats/sheet'

export interface FleetSupplyDrainResult {
  hangarsTouched: number
  shipsDraining: number
  totalDrainSupply: number
  hangarsRunDry: number
}

// Walks every hangar across `hangarWorld`, walks every Ship across
// `shipWorld`, aggregates per-POI supply drain from non-mothballed ships
// at supplyPerDay > 0, and debits the host hangar's supplyCurrent (cap
// at 0).
//
// Idempotent within a day: relies on the caller to fire exactly once
// per `day:rollover:settled`. The boot subscription enforces this.
export function fleetSupplyDrainSystem(
  hangarWorld: World,
  shipWorld: World,
  _gameDay: number,
): FleetSupplyDrainResult {
  const result: FleetSupplyDrainResult = {
    hangarsTouched: 0,
    shipsDraining: 0,
    totalDrainSupply: 0,
    hangarsRunDry: 0,
  }

  // Group drain by host POI so a single hangar's supplyCurrent is hit
  // once per tick, even if the POI hosts multiple ships.
  const drainByPoi = new Map<string, number>()
  for (const ship of shipWorld.query(Ship)) {
    const s = ship.get(Ship)!
    if (s.mothballed) continue
    if (!s.dockedAtPoiId) continue  // in-flight ships drain off-hangar at 6.2.E2+
    const perDay = supplyPerDayOf(ship)
    if (perDay <= 0) continue
    result.shipsDraining += 1
    drainByPoi.set(s.dockedAtPoiId, (drainByPoi.get(s.dockedAtPoiId) ?? 0) + perDay)
  }

  for (const hangar of hangarWorld.query(Building, Hangar)) {
    const sceneId = sceneIdForHangar(hangar)
    const poiId = poiIdForScene(sceneId)
    if (!poiId) continue
    const requested = drainByPoi.get(poiId) ?? 0
    if (requested <= 0) continue
    result.hangarsTouched += 1
    const cur = hangar.get(Hangar)!
    const applied = Math.min(requested, cur.supplyCurrent)
    result.totalDrainSupply += applied
    if (applied < requested) result.hangarsRunDry += 1
    if (applied > 0) {
      hangar.set(Hangar, { ...cur, supplyCurrent: cur.supplyCurrent - applied })
    }
  }

  return result
}

// Public for the HUD readout. Aggregates the current supplyCurrent +
// supplyMax (and fuel) across every hangar in the passed world. The
// caller stitches multi-world (vonBraunCity + granadaDrydock) sums.
export function aggregateHangarReserves(hangarWorld: World): {
  supplyCurrent: number; supplyMax: number;
  fuelCurrent: number; fuelMax: number;
} {
  let sc = 0, sm = 0, fc = 0, fm = 0
  for (const ent of hangarWorld.query(Building, Hangar)) {
    const h = ent.get(Hangar)!
    sc += h.supplyCurrent
    sm += h.supplyMax
    fc += h.fuelCurrent
    fm += h.fuelMax
  }
  return { supplyCurrent: sc, supplyMax: sm, fuelCurrent: fc, fuelMax: fm }
}

function supplyPerDayOf(ship: Entity): number {
  // Authoritative read from the ShipStatSheet — Effects may modify
  // (officer-bonus to logistics, faction research, doctrine). Falls back
  // to 0 when no sheet is attached (legacy entities pre-6.2.B).
  if (!ship.has(ShipStatSheet)) return 0
  return getStat(ship.get(ShipStatSheet)!.sheet, 'supplyPerDay')
}

function sceneIdForHangar(hangar: Entity): string {
  // EntityKey format set in spawn.ts: `bld-<sceneId>-<typeId>-<n>`.
  const key = hangar.get(EntityKey)?.key ?? ''
  if (!key.startsWith('bld-')) return ''
  const rest = key.slice(4)
  const dash = rest.indexOf('-')
  if (dash < 0) return ''
  return rest.slice(0, dash)
}

function poiIdForScene(sceneId: string): string | null {
  if (!sceneId) return null
  for (const poi of POIS) {
    if (poi.sceneId === sceneId) return poi.id
  }
  return null
}
