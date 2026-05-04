// NPC scheduling buckets (per-entity bucket assignment, last-action
// memo, BT-step timestamps, wake queue, cursor counters). Transient —
// reconstructed by npcSystem from live entities, never snapshotted.

import { registerSaveHandler } from '../../save/registry'
import { resetNpcBuckets } from '../../systems/npc'

registerSaveHandler({
  id: 'npc',
  snapshot: () => undefined,
  restore: () => { /* unreachable — snapshot returns undefined */ },
  reset: () => resetNpcBuckets(),
})
