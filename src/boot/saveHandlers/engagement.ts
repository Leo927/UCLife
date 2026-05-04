// Engagement modal state is transient — UI and contact-detection
// cooldowns get cleared on load so a stale modal / cooldown can't
// outlive the round-trip. Never snapshotted.

import { registerSaveHandler } from '../../save/registry'
import { resetEngagementCooldowns } from '../../sim/engagement'

registerSaveHandler({
  id: 'engagement',
  snapshot: () => undefined,
  restore: () => { /* unreachable — snapshot returns undefined */ },
  reset: () => resetEngagementCooldowns(),
})
