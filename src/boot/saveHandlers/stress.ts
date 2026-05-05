// Inactive-NPC stress accumulator (deferred saturation feeds while
// off-screen). Transient — recomputed from per-entity Attributes,
// never snapshotted. Reset fans out to every per-scene world's singleton.

import { registerSaveHandler } from '../../save/registry'
import { resetStressAccum } from '../../systems/stress'
import { SCENE_IDS, getWorld } from '../../ecs/world'

registerSaveHandler({
  id: 'stress',
  snapshot: () => undefined,
  restore: () => { /* unreachable — snapshot returns undefined */ },
  reset: () => {
    for (const id of SCENE_IDS) resetStressAccum(getWorld(id))
  },
})
