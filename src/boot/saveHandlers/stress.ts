// Inactive-NPC stress accumulator (deferred saturation feeds while
// off-screen). Transient — recomputed from per-entity Attributes,
// never snapshotted.

import { registerSaveHandler } from '../../save/registry'
import { resetStressAccum } from '../../systems/stress'

registerSaveHandler({
  id: 'stress',
  snapshot: () => undefined,
  restore: () => { /* unreachable — snapshot returns undefined */ },
  reset: () => resetStressAccum(),
})
