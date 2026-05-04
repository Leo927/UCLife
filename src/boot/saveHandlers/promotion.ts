// Promotion notice memo (per-family last-noticed rank). Transient —
// rebuilt from observation as the player progresses, never snapshotted.

import { registerSaveHandler } from '../../save/registry'
import { resetPromotionNotices } from '../../systems/promotion'

registerSaveHandler({
  id: 'promotion',
  snapshot: () => undefined,
  restore: () => { /* unreachable — snapshot returns undefined */ },
  reset: () => resetPromotionNotices(),
})
