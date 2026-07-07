// W4.1 — translates the sim `ship:crew-reconcile` fact (the player boarded
// a hull / switched flagships) into a systems/crewAboard reconcile. Same
// inversion pattern as boot/fleetLaunchBinding.ts: sim emits the fact,
// systems decides the consequence (re-body the flagship's crew), so sim/
// never imports upward into systems/.

import { onSim } from '../sim/events'
import { reconcileCrewAboard } from '../systems/crewAboard'

let bound = false

export function bindCrewAboard(): void {
  if (bound) return
  bound = true

  onSim('ship:crew-reconcile', () => {
    reconcileCrewAboard()
  })
}
