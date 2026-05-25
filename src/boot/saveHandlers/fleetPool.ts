// Fleet-level fuel pool save handler. Pairs with the ship save handler
// (which restores the roster + recomputes fuelMax) — this one persists
// only fuelCurrent and clamps to whatever capacity the recompute landed.
// Registered after `ship` in boot/saveHandlers/index.ts so the recompute
// has run before restore() reads back the pool.

import { registerSaveHandler } from '../../save/registry'
import { getWorld } from '../../ecs/world'
import { FleetPool } from '../../ecs/traits'

const SHIP_SCENE_ID = 'playerShipInterior'

interface FleetPoolBlock {
  fuelCurrent: number
}

function snapshot(): FleetPoolBlock | undefined {
  const ent = getWorld(SHIP_SCENE_ID).queryFirst(FleetPool)
  if (!ent) return undefined
  return { fuelCurrent: ent.get(FleetPool)!.fuelCurrent }
}

function restore(blob: FleetPoolBlock): void {
  const ent = getWorld(SHIP_SCENE_ID).queryFirst(FleetPool)
  if (!ent) return
  const cur = ent.get(FleetPool)!
  ent.set(FleetPool, {
    fuelMax: cur.fuelMax,
    fuelCurrent: Math.min(blob.fuelCurrent, cur.fuelMax),
  })
}

registerSaveHandler<FleetPoolBlock>({
  id: 'fleetPool',
  snapshot,
  restore,
})
