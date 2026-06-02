// Phase 6.3.C — wires colonyConstructionSystem to day:rollover:settled so
// construction jobs advance after the full daily rollup chain (economics,
// housing, recruitment) has settled. Mirrors the pattern in
// colonyEconomicsTick.ts.

import { onSim } from '../sim/events'
import { colonyConstructionSystem } from '../systems/colonyConstruction'

onSim('day:rollover:settled', ({ gameDay }) => {
  colonyConstructionSystem(gameDay)
})
