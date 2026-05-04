// SpaceSim once-per-trip flags + per-key engagement / aggro cooldowns.
// Transient — never snapshotted; cooldowns rebuild from live encounters.

import { registerSaveHandler } from '../../save/registry'
import { resetSpaceSimFlags } from '../../systems/spaceSim'

registerSaveHandler({
  id: 'spaceSim',
  snapshot: () => undefined,
  restore: () => { /* unreachable — snapshot returns undefined */ },
  reset: () => resetSpaceSimFlags(),
})
