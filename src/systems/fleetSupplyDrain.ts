// Daily fleet-supply upkeep tick. Per ship Design/fleet.md:
//
//   fleetSupplyPerDay =
//       sum(ship.template.supplyPerDay for each non-mothballed ship)
//     + sum(ms.template.supplyPerDay for each MS in any non-mothballed hangar)
//     + sum(ms.template.supplyPerRepairDay for each MS in repair)
//     + crewUpkeepPerDay
//
// 6.2.F lands the *ship-tier* term only; MS terms land at 6.2.5 and
// crewUpkeep at 6.2.D/H. Starsector-style consolidation: the drain
// debits the fleet-level supply pool (FleetPool singleton) instead of
// the per-hangar warehouse — supplies are a shared fleet resource, not
// a per-dock stockpile. Hangars retain their own Hangar.supplyCurrent
// as a refill warehouse the player resupplies *from* when docked.
//
// Caps at zero — running dry surfaces in the manager dialog (缺补给)
// and as a HUD gauge tint without breaking the tick.
//
// Multi-world iteration: ships live in playerShipInterior (and, post-
// 6.2.E2, possibly elsewhere). The caller (boot/fleetSupplyTick.ts)
// hands in the ship world so this module stays decoupled from
// getWorld().

import type { Entity, World } from 'koota'
import { Building, Hangar, Ship, ShipStatSheet } from '../ecs/traits'
import { getStat } from '../stats/sheet'
import { spendFleetSupply } from '../ecs/fleetPool'

export interface FleetSupplyDrainResult {
  shipsDraining: number
  totalDrainSupply: number
  ranDry: boolean
}

// Walks every Ship in `shipWorld`, aggregates supplyPerDay across
// non-mothballed ships at supplyPerDay > 0, and debits the fleet pool
// in one shot (cap at 0). The `spend` parameter is the seam tests use
// to isolate the global FleetPool singleton — production code defaults
// to the real fleet-pool debit.
//
// Idempotent within a day: relies on the caller to fire exactly once
// per `day:rollover:settled`. The boot subscription enforces this.
export function fleetSupplyDrainSystem(
  _hangarWorld: World,
  shipWorld: World,
  _gameDay: number,
  spend: (amount: number) => number = spendFleetSupply,
): FleetSupplyDrainResult {
  const result: FleetSupplyDrainResult = {
    shipsDraining: 0,
    totalDrainSupply: 0,
    ranDry: false,
  }

  let requested = 0
  for (const ship of shipWorld.query(Ship)) {
    const s = ship.get(Ship)!
    if (s.mothballed) continue
    const perDay = supplyPerDayOf(ship)
    if (perDay <= 0) continue
    result.shipsDraining += 1
    requested += perDay
  }
  if (requested <= 0) return result

  const applied = spend(requested)
  result.totalDrainSupply = applied
  result.ranDry = applied < requested
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

