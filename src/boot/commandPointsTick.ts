// Issue #69 — wires the per-day Command-Point partial refill to
// `day:rollover:settled`. A long campaign leg slowly tops the CP pool back
// up between engagements (Design/fleet.md §Command points). Mirrors
// boot/fleetTransitTick.ts so the loop doesn't reach into systems/.

import { onSim } from '../sim/events'
import { dailyRefillCommandPoints } from '../systems/fleetCommandPoints'

onSim('day:rollover:settled', () => {
  dailyRefillCommandPoints()
})
