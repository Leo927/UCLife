// Issue #69 — Command-Point + Deployment-Point debug handles. Smoke-test
// surface for the CP/DP wiring: compute the DP cap, commit ships up to it,
// read the CP pool, issue fleet-wide orders (debit / refuse), and inspect
// the doctrine mapping. Mirrors src/boot/debugHandles/fleet.ts.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import {
  computeDpCap, deploymentDescribe, commitShipToEngagement,
  uncommitShipFromEngagement, computeMaxCommandPoints, commandPoolDescribe,
  issueFleetOrder, dpCostForShip, doctrineForAggression, dailyRefillCommandPoints,
} from '../../systems/fleetCommandPoints'
import { findShipByKey } from '../../systems/fleetCrew'
import { useCombatLog } from '../../sim/combatLog'

registerDebugHandle('computeDpCap', () => computeDpCap())
registerDebugHandle('deploymentDescribe', () => deploymentDescribe())
registerDebugHandle('commitShipToEngagement', (shipKey: string) =>
  commitShipToEngagement(shipKey),
)
registerDebugHandle('uncommitShipFromEngagement', (shipKey: string) =>
  uncommitShipFromEngagement(shipKey),
)

registerDebugHandle('computeMaxCommandPoints', () => computeMaxCommandPoints())
registerDebugHandle('commandPoolDescribe', () => commandPoolDescribe())
registerDebugHandle('issueFleetOrder', (orderId: string) => issueFleetOrder(orderId))
registerDebugHandle('dailyRefillCommandPointsCheat', () => {
  dailyRefillCommandPoints()
  return commandPoolDescribe()
})

// Read a ship's dpCost off its StatSheet (projected from the class at spawn).
registerDebugHandle('dpCostForShipKey', (shipKey: string): number | null => {
  const ship = findShipByKey(shipKey)
  if (!ship) return null
  return dpCostForShip(ship)
})

registerDebugHandle('doctrineForAggression', (aggression: string) =>
  doctrineForAggression(aggression),
)

// Combat-log reader (text + severity per entry). Smoke asserts the
// `CP exhausted` / `CP regen` lines land. No combat-log handle existed
// before Issue #69; this is the natural consumer.
registerDebugHandle('combatLogEntries', () =>
  useCombatLog.getState().entries.map((e) => ({
    textZh: e.textZh,
    severity: e.severity,
  })),
)
