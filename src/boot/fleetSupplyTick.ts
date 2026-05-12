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
  // Hangars live in city / drydock scenes. Walk each one's world for
  // deliveries + drain. Ships live in playerShipInterior — drain reads
  // off whichever scene's hangar matches each ship's dockedAtPoiId.
  const shipWorld = getWorld('playerShipInterior')
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    fleetSupplyDeliverySystem(w, gameDay)
    fleetSupplyDrainSystem(w, shipWorld, gameDay)
  }
})
