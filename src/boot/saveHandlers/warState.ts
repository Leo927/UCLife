// Phase 7.0.B — persists the war state (IsWartime gate + strategic-war
// faction-strength model + resolved war-event ids). A save made post-flip
// loads wartime; a pre-flip save has no blob here, so reset() leaves the
// world pre-war. Module store, no entity dependency → default 'post' phase.

import { registerSaveHandler } from '../../save/registry'
import {
  snapshotWarState, restoreWarState, resetWarState, type WarStateSnapshot,
} from '../../sim/warState'

registerSaveHandler<WarStateSnapshot>({
  id: 'warState',
  snapshot: () => {
    const snap = snapshotWarState()
    // Pre-war saves carry nothing — skip the write so legacy/pre-flip bundles
    // stay clean and load pre-war via reset().
    if (!snap.isWartime) return undefined
    return snap
  },
  restore: (blob) => restoreWarState(blob),
  reset: () => resetWarState(),
})
