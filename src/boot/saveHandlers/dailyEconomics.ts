// Phase 5.5.2 daily-economics module-local state. The per-faction
// stipend-day dedupe map lives outside the koota world (it's keyed by
// FactionId, not by entity), so a fresh load needs to clear it — otherwise
// the next post-load rollover sees "already paid today" and skips.

import { registerSaveHandler } from '../../save/registry'
import { resetDailyEconomics } from '../../systems/dailyEconomics'

registerSaveHandler({
  id: 'dailyEconomics',
  snapshot: () => undefined,
  restore: () => { /* unreachable — snapshot returns undefined */ },
  reset: () => resetDailyEconomics(),
})
