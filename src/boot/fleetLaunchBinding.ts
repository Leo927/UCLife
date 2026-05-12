// Phase 6.2.E2 — translates sim flagship-undock / flagship-dock events
// into systems/fleetLaunch calls. Same inversion pattern as
// boot/uiBindings.ts: sim emits a fact (the flagship just left port,
// the flagship just parked), systems decides the consequence (auto-
// launch escorts, queue cross-POI transit, despawn FleetEscort bodies).

import { onSim } from '../sim/events'
import { onFlagshipUndock, onFlagshipDock } from '../systems/fleetLaunch'

let bound = false

export function bindFleetLaunch(): void {
  if (bound) return
  bound = true

  onSim('fleet:flagship-undock', ({ originPoiId, gameDay }) => {
    onFlagshipUndock(originPoiId, gameDay)
  })
  onSim('fleet:flagship-dock', ({ destPoiId }) => {
    onFlagshipDock(destPoiId)
  })
}
