// Active-zone membership tick throttle. Transient — the next tick
// recomputes membership from camera bounds, never snapshotted. Reset
// fans out to every per-scene world so each world's singleton starts
// fresh after a load.

import { registerSaveHandler } from '../../save/registry'
import { resetActiveZone } from '../../systems/activeZone'
import { SCENE_IDS, getWorld } from '../../ecs/world'

registerSaveHandler({
  id: 'activeZone',
  snapshot: () => undefined,
  restore: () => { /* unreachable — snapshot returns undefined */ },
  reset: () => {
    for (const id of SCENE_IDS) resetActiveZone(getWorld(id))
  },
})
