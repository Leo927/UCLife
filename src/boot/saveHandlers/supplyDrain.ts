// Ship supply-drain tick gate + once-per-trip log flag. Transient —
// next tick re-seeds lastTickMs, never snapshotted.

import { registerSaveHandler } from '../../save/registry'
import { resetSupplyDrain } from '../../systems/supplyDrain'

registerSaveHandler({
  id: 'supplyDrain',
  snapshot: () => undefined,
  restore: () => { /* unreachable — snapshot returns undefined */ },
  reset: () => resetSupplyDrain(),
})
