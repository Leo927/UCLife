// Phase 6.2.5.B — wires `msDeliverySystem` to `day:rollover:settled` so
// the AE vehicle broker's pending MS deliveries flip to 'arrived' on the
// expected game day. Parallel to shipDeliveryTick.ts (same event, separate
// queue).

import { onSim } from '../sim/events'
import { msDeliverySystem } from '../systems/msDelivery'

onSim('day:rollover:settled', ({ gameDay }) => {
  msDeliverySystem(gameDay)
})
