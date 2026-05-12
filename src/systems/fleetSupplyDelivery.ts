// Phase 6.2.F supply / fuel delivery pipeline. The AE dealer's order-
// supply / order-fuel verbs (and the secretary's bulk-order verb at the
// faction office) call enqueueSupplyDelivery() to queue a shipment
// against a target hangar. The per-day system below decrements
// daysRemaining on every entry; when it hits zero, the units land on
// the target hangar's supplyCurrent / fuelCurrent (capped at the
// matching max) and the entry is removed.
//
// Pipeline is distinct from the ship-delivery pipeline (6.2.C1) so the
// two slices don't collide on shared infrastructure — the day-rollover
// trigger is the same event (`day:rollover:settled`), but each slice
// owns its own queue, save block, and verbs.

import type { Entity, World } from 'koota'
import { Building, Hangar } from '../ecs/traits'
import type { PendingSupplyDelivery, SupplyKind } from '../ecs/traits'

export interface FleetSupplyDeliveryResult {
  hangarsTouched: number
  deliveriesLanded: number
  unitsAppliedSupply: number
  unitsAppliedFuel: number
}

export function fleetSupplyDeliverySystem(
  hangarWorld: World,
  _gameDay: number,
): FleetSupplyDeliveryResult {
  const result: FleetSupplyDeliveryResult = {
    hangarsTouched: 0,
    deliveriesLanded: 0,
    unitsAppliedSupply: 0,
    unitsAppliedFuel: 0,
  }

  for (const hangarEnt of hangarWorld.query(Building, Hangar)) {
    const cur = hangarEnt.get(Hangar)!
    if (cur.pendingSupplyDeliveries.length === 0) continue
    result.hangarsTouched += 1

    const keep: PendingSupplyDelivery[] = []
    let supplyCurrent = cur.supplyCurrent
    let fuelCurrent = cur.fuelCurrent

    for (const d of cur.pendingSupplyDeliveries) {
      const nextDays = d.daysRemaining - 1
      if (nextDays > 0) {
        keep.push({ kind: d.kind, qty: d.qty, daysRemaining: nextDays })
        continue
      }
      // Land it — cap at the corresponding max.
      if (d.kind === 'supply') {
        const next = Math.min(supplyCurrent + d.qty, cur.supplyMax)
        result.unitsAppliedSupply += next - supplyCurrent
        supplyCurrent = next
      } else {
        const next = Math.min(fuelCurrent + d.qty, cur.fuelMax)
        result.unitsAppliedFuel += next - fuelCurrent
        fuelCurrent = next
      }
      result.deliveriesLanded += 1
    }

    hangarEnt.set(Hangar, {
      ...cur,
      supplyCurrent,
      fuelCurrent,
      pendingSupplyDeliveries: keep,
    })
  }

  return result
}

// Called by the AE dealer / secretary dialogs. Idempotent shape — each
// call appends a row; orders accumulate when the player places multiple
// in one day. Caller is responsible for validating money + qty.
export function enqueueSupplyDelivery(
  hangarEnt: Entity,
  kind: SupplyKind,
  qty: number,
  daysRemaining: number,
): void {
  const cur = hangarEnt.get(Hangar)
  if (!cur) return
  if (qty <= 0 || daysRemaining < 0) return
  hangarEnt.set(Hangar, {
    ...cur,
    pendingSupplyDeliveries: [
      ...cur.pendingSupplyDeliveries,
      { kind, qty, daysRemaining },
    ],
  })
}
