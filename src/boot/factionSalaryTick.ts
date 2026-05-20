// Wires `factionSalarySystem` to `day:rollover:settled` so the unified
// faction-member daily salary debit lands alongside the other daily
// economic ticks (facility salaries via dailyEconomics, fleet supply
// drain, ship repair throughput).

import { onSim } from '../sim/events'
import { getWorld } from '../ecs/world'
import { factionSalarySystem } from '../systems/factionSalary'

onSim('day:rollover:settled', ({ gameDay }) => {
  const shipWorld = getWorld('playerShipInterior')
  factionSalarySystem(shipWorld, gameDay)
})
