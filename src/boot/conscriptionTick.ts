// Phase 7.0.C — runs the conscription draft roll on day:rollover:settled
// (gated on isWartime + the configured cadence). Subscription lives in boot/
// so the loop and the system stay free of upward imports.

import { onSim } from '../sim/events'
import { useClock } from '../sim/clock'
import { conscriptionTick } from '../systems/conscription'

onSim('day:rollover:settled', ({ gameDay }) => {
  conscriptionTick(gameDay, useClock.getState().gameDate.getTime())
})
