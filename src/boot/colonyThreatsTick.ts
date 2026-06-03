// Phase 6.3.E — wires colonyThreatsSystem to day:rollover:settled so
// pirate raid rolls + stability-collapse grace checks run after the full
// daily rollup chain (economics, construction) has settled. Mirrors the
// pattern in colonyEconomicsTick.ts and colonyConstructionTick.ts.

import { onSim } from '../sim/events'
import { colonyThreatsSystem } from '../systems/colonyThreats'

onSim('day:rollover:settled', ({ gameDay }) => {
  colonyThreatsSystem(gameDay)
})
