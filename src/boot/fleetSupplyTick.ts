// Phase 6.2.F — wires `fleetSupplyDrainSystem` + `fleetSupplyDeliverySystem`
// to `day:rollover:settled` so the loop's day-rollup chain
// (dailyEconomics → housingPressure → recruitment → research → hangarRepair)
// finishes before fleet logistics tick. Mirrors `boot/hangarRepairTick.ts`
// so the loop doesn't reach upward into systems/.
//
// Order within the settled bus is unspecified across subscribers, but
// drain and delivery within this file run in a fixed order: deliveries
// land first (so a same-day order that would arrive today is credited
// before the same day's drain), then drain debits.

import { onSim } from '../sim/events'
import { SCENE_IDS, getWorld } from '../ecs/world'
import { fleetSupplyDrainSystem } from '../systems/fleetSupplyDrain'
import { fleetSupplyDeliverySystem } from '../systems/fleetSupplyDelivery'

onSim('day:rollover:settled', ({ gameDay }) => {
  // Deliveries land per-hangar, so walk every scene's world for them.
  for (const sceneId of SCENE_IDS) {
    fleetSupplyDeliverySystem(getWorld(sceneId), gameDay)
  }
  // Drain debits the global fleet pool exactly once per day. Ships and MS
  // both live in playerShipInterior; pass both worlds explicitly so the
  // system stays decoupled from getWorld(). Running it inside the per-scene
  // loop would multi-debit the pool by the scene count.
  const shipWorld = getWorld('playerShipInterior')
  const msWorld = getWorld('playerShipInterior')
  fleetSupplyDrainSystem(shipWorld, msWorld, gameDay)
})
