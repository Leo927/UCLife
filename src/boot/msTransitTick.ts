// Phase 6.2.5.B — wires `msTransitSystem` to `day:rollover:settled` so
// in-transit MS land at their destination on the expected game day.
// Parallel to fleetTransitTick.ts (Ships) and msDeliveryTick.ts (broker
// queue); same event, separate side effect.
//
// Refresh the depot MS layout after landing so a newly-arrived MS sprite
// appears in the destination scene without the player having to leave +
// re-enter it.

import { onSim } from '../sim/events'
import { msTransitSystem } from '../systems/msTransfer'
import { refreshAllDepotMsLayouts, refreshMsLayout } from '../ecs/spawn'

onSim('day:rollover:settled', ({ gameDay }) => {
  const result = msTransitSystem(gameDay)
  if (result.msLanded > 0) {
    refreshMsLayout()
    refreshAllDepotMsLayouts()
  }
})
