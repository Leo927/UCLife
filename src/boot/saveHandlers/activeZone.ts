// Active-zone membership tick throttle. Transient — the next tick
// recomputes membership from camera bounds, never snapshotted.

import { registerSaveHandler } from '../../save/registry'
import { resetActiveZone } from '../../systems/activeZone'

registerSaveHandler({
  id: 'activeZone',
  snapshot: () => undefined,
  restore: () => { /* unreachable — snapshot returns undefined */ },
  reset: () => resetActiveZone(),
})
