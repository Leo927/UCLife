// Phase 7.0.B — wires the war-transition orchestrator + strategic-war model
// to day:rollover:settled (after economics + colonies + faction-tier settle).
// The subscription lives in boot/ so the loop stays free of upward imports
// into systems/. Transition runs before strategic resolution so the model is
// seeded before the first day's war events resolve.

import { onSim } from '../sim/events'
import { useClock } from '../sim/clock'
import { warTransitionSystem } from '../systems/warTransition'
import { strategicWarSystem } from '../systems/strategicWar'

onSim('day:rollover:settled', ({ gameDay }) => {
  const date = useClock.getState().gameDate
  warTransitionSystem(date, gameDay)
  strategicWarSystem(date, gameDay)
})
