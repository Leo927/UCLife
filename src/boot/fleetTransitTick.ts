// Phase 6.2.E2 — wires `fleetTransitSystem` to `day:rollover:settled`
// so cross-POI ship transits land at their `arrivalDay`. Mirrors
// boot/shipDeliveryTick.ts so the loop doesn't reach into systems/.

import { onSim } from '../sim/events'
import { fleetTransitSystem } from '../systems/fleetTransit'

onSim('day:rollover:settled', ({ gameDay }) => {
  fleetTransitSystem(gameDay)
})
