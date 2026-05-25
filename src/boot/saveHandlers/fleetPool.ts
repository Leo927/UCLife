// Fleet-level fuel + supply pool save handler. Pairs with the ship
// save handler (which restores the roster + recomputes the pool
// capacities) — this one persists only the currents and clamps to
// whatever capacity the recompute landed. Registered after `ship` in
// boot/saveHandlers/index.ts so the recompute has run before restore()
// reads back the pool.

import { registerSaveHandler } from '../../save/registry'
import { getWorld } from '../../ecs/world'
import { FleetPool } from '../../ecs/traits'

const SHIP_SCENE_ID = 'playerShipInterior'

interface FleetPoolBlock {
  fuelCurrent: number
  // Pre-supply-pool saves omit this; load tolerates its absence by
  // leaving the recomputed supply pool at full.
  supplyCurrent?: number
}

function snapshot(): FleetPoolBlock | undefined {
  const ent = getWorld(SHIP_SCENE_ID).queryFirst(FleetPool)
  if (!ent) return undefined
  const p = ent.get(FleetPool)!
  return { fuelCurrent: p.fuelCurrent, supplyCurrent: p.supplyCurrent }
}

function restore(blob: FleetPoolBlock): void {
  const ent = getWorld(SHIP_SCENE_ID).queryFirst(FleetPool)
  if (!ent) return
  const cur = ent.get(FleetPool)!
  ent.set(FleetPool, {
    fuelMax: cur.fuelMax,
    fuelCurrent: Math.min(blob.fuelCurrent, cur.fuelMax),
    supplyMax: cur.supplyMax,
    supplyCurrent: Math.min(blob.supplyCurrent ?? cur.supplyCurrent, cur.supplyMax),
  })
}

registerSaveHandler<FleetPoolBlock>({
  id: 'fleetPool',
  snapshot,
  restore,
})
