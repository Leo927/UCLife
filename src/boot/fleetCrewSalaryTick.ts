// Phase 6.2.D — wires `fleetCrewSalarySystem` to `day:rollover:settled`
// so per-ship captain + crew salary debits land alongside the other
// fleet-tier daily ticks (supply drain, supply delivery, repair).
// Mirrors `boot/fleetSupplyTick.ts` shape so the loop stays decoupled
// from systems/.

import { onSim } from '../sim/events'
import { getWorld } from '../ecs/world'
import { fleetCrewSalarySystem } from '../systems/fleetCrew'

onSim('day:rollover:settled', ({ gameDay }) => {
  const shipWorld = getWorld('playerShipInterior')
  fleetCrewSalarySystem(shipWorld, gameDay)
})
