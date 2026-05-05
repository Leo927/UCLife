// Inactive-NPC vitals accumulator (deferred drain bookkeeping while
// off-screen). Transient — recomputed from per-entity Vitals, never
// snapshotted. Reset fans out to every per-scene world's singleton.

import { registerSaveHandler } from '../../save/registry'
import { resetVitalsAccum } from '../../systems/vitals'
import { SCENE_IDS, getWorld } from '../../ecs/world'

registerSaveHandler({
  id: 'vitals',
  snapshot: () => undefined,
  restore: () => { /* unreachable — snapshot returns undefined */ },
  reset: () => {
    for (const id of SCENE_IDS) resetVitalsAccum(getWorld(id))
  },
})
