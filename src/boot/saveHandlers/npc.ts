// NPC scheduling buckets (per-entity bucket assignment, last-action
// memo, BT-step timestamps, wake queue, cursor counters). Transient —
// reconstructed by npcSystem from live entities, never snapshotted.
// Reset fans out to every per-scene world's singleton.

import { registerSaveHandler } from '../../save/registry'
import { resetNpcBuckets } from '../../systems/npc'
import { SCENE_IDS, getWorld } from '../../ecs/world'

registerSaveHandler({
  id: 'npc',
  snapshot: () => undefined,
  restore: () => { /* unreachable — snapshot returns undefined */ },
  reset: () => {
    for (const id of SCENE_IDS) resetNpcBuckets(getWorld(id))
  },
})
