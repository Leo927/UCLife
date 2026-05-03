// Continuous supply drain — base life support + per-MS maintenance load +
// optional combat-repair surcharge. Driven once per game-tick from loop.ts;
// elapsed minutes are derived from the clock so any speed multiplier is
// already baked in.

import { spendSupplies, getShipState, getPlayerShipEntity } from '../sim/ship'
import { useCombatStore } from './combat'
import { spaceConfig } from '../config'
import { MaintenanceLoad } from '../ecs/traits'
import { logEvent } from '../ui/EventLog'

let lastTickMs: number | null = null
let suppliesOutLogged = false

export function supplyDrainSystem(now: Date): void {
  const ms = now.getTime()
  if (lastTickMs === null) { lastTickMs = ms; return }
  const elapsedMin = (ms - lastTickMs) / 60000
  if (elapsedMin <= 0) return
  lastTickMs = ms

  const ship = getShipState()
  if (!ship) return

  let drainPerHour = spaceConfig.supplyDrainPerHour

  // Per-MS maintenance: read MaintenanceLoad off the player ship (slice 7
  // baseline is 0; future fleet-roster work multiplies this with carried
  // mech count).
  const ent = getPlayerShipEntity()
  if (ent) {
    const ml = ent.get(MaintenanceLoad)
    if (ml && ml.loadUnits > 0) {
      drainPerHour += ml.loadUnits * spaceConfig.perMaintenanceLoadDrainPerHour
    }
  }

  if (useCombatStore.getState().open) {
    drainPerHour += spaceConfig.combatRepairDrainPerSec * 3600
  }

  const drainThisTick = drainPerHour * (elapsedMin / 60)
  spendSupplies(drainThisTick)

  const after = getShipState()
  if (after) {
    if (after.suppliesCurrent <= 0 && !suppliesOutLogged) {
      suppliesOutLogged = true
      logEvent('补给耗尽 · 士气崩溃风险')
    } else if (after.suppliesCurrent > 0 && suppliesOutLogged) {
      suppliesOutLogged = false
    }
  }
}

export function resetSupplyDrain(): void {
  lastTickMs = null
  suppliesOutLogged = false
}
