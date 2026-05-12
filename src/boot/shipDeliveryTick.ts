// Phase 6.2.C1 — wires `shipDeliverySystem` to `day:rollover:settled` so
// the in-transit row flips to 'arrived' the day-rollover the player
// expected. Subscription lives here so the loop doesn't reach into
// systems/ (same arch boundary the hangar repair tick already obeys).

import { onSim } from '../sim/events'
import { shipDeliverySystem } from '../systems/shipDelivery'

onSim('day:rollover:settled', ({ gameDay }) => {
  shipDeliverySystem(gameDay)
})
