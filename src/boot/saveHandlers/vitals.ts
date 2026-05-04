// Inactive-NPC vitals accumulator (deferred drain bookkeeping while
// off-screen). Transient — recomputed from per-entity Vitals, never
// snapshotted.

import { registerSaveHandler } from '../../save/registry'
import { resetVitalsAccum } from '../../systems/vitals'

registerSaveHandler({
  id: 'vitals',
  snapshot: () => undefined,
  restore: () => { /* unreachable — snapshot returns undefined */ },
  reset: () => resetVitalsAccum(),
})
