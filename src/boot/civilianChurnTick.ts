// Phase 7.0.E.2 — runs the wartime non-combatant churn roll on
// day:rollover:settled (gated on isWartime + the configured cadence inside
// civilianChurnTick). Subscription lives in boot/ so the loop and the system
// stay free of upward imports.

import { onSim } from '../sim/events'
import { useClock } from '../sim/clock'
import { civilianChurnTick } from '../systems/civilianChurn'

onSim('day:rollover:settled', ({ gameDay }) => {
  civilianChurnTick(gameDay, useClock.getState().gameDate.getTime())
})
