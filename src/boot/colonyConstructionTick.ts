// Phase 6.3.C — wires `colonyConstructionSystem` to `day:rollover:settled`
// so the construction timer advances each game-day after the economics
// chain settles. Mirrors the shape of colonyEconomicsTick.ts.

import { onSim } from '../sim/events'
import { colonyConstructionSystem } from '../systems/colonyConstruction'

onSim('day:rollover:settled', (e) => {
  colonyConstructionSystem(e.gameDay)
})
