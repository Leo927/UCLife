// Phase 7.0.C — persists the conscription draft state (outstanding notice,
// cadence/cooldown bookkeeping, resolution outcome, held medical letter). A
// mid-cooldown save reloads mid-cooldown. Module store, no entity dependency
// → default 'post' phase.

import { registerSaveHandler } from '../../save/registry'
import {
  snapshotConscription, restoreConscription, resetConscription,
  type ConscriptionSnapshot,
} from '../../sim/conscriptionState'

registerSaveHandler<ConscriptionSnapshot>({
  id: 'conscription',
  snapshot: () => {
    const snap = snapshotConscription()
    // Nothing happens pre-war; skip the write until the draft has touched
    // state so legacy/pre-war bundles stay clean.
    if (
      !snap.noticeOutstanding && snap.lastRollDay === 0
      && snap.resolution === 'none' && !snap.medicalLetterHeld
    ) {
      return undefined
    }
    return snap
  },
  restore: (blob) => restoreConscription(blob),
  reset: () => resetConscription(),
})
