// Asymmetric Knows graph between keyed characters. Phase 'post' because
// edges reference entities — must run after the entity overlay has
// rebuilt + immigrated everything in byKey.
//
// We re-walk world.query(EntityKey) here to assemble byKey rather than
// extending the SaveHandler interface to thread context through. It's
// one O(N) pass per load and keeps the registry contract minimal.

import { registerSaveHandler } from '../../save/registry'
import { world } from '../../ecs/world'
import { EntityKey } from '../../ecs/traits'
import {
  snapshotRelations,
  restoreRelations,
  resetRelationsClock,
  type RelationSnap,
} from '../../systems/relations'
import type { Entity } from 'koota'

registerSaveHandler<RelationSnap[]>({
  id: 'relations',
  phase: 'post',
  snapshot: () => snapshotRelations(world),
  restore: (blob) => {
    const byKey = new Map<string, Entity>()
    for (const e of world.query(EntityKey)) {
      byKey.set(e.get(EntityKey)!.key, e)
    }
    restoreRelations(world, byKey, blob)
  },
  reset: () => resetRelationsClock(),
})
