// Phase 7.0.D — resolves the player's ambition warPayoff routes when the war
// fires. Subscribes to the 7.0.B `war:transition` event (emitted by
// warTransitionSystem after the IsWartime flip), keeping the loop and the
// transition orchestrator free of an upward import into the ambition catalog.

import { onSim } from '../sim/events'
import { useClock } from '../sim/clock'
import { warPayoffSystem } from '../systems/warPayoff'

onSim('war:transition', () => {
  warPayoffSystem(useClock.getState().gameDate)
})
