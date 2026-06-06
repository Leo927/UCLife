// Phase 7.0.A — newsfeed save handler. Persists the player's consumed-headline
// journal and the one-shot war-day-toast flag. The news content table itself
// is static data (news.json5); only the player's per-run progress lives here.

import { registerSaveHandler } from '../../save/registry'
import {
  snapshotNewsfeed, restoreNewsfeed, resetNewsfeed, type NewsfeedSnapshot,
} from '../../sim/newsfeed'

registerSaveHandler<NewsfeedSnapshot>({
  id: 'newsfeed',
  phase: 'post',
  snapshot: () => {
    const snap = snapshotNewsfeed()
    if (snap.journal.length === 0 && !snap.warDayToastFired) return undefined
    return snap
  },
  restore: (blob) => {
    restoreNewsfeed(blob)
  },
  reset: () => {
    resetNewsfeed()
  },
})
