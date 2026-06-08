// Phase 7.0.E.2 — persists the civilian-churn bookkeeping (which non-combatant
// named NPCs have churned out + the cadence roll day). A mid-war save reloads
// with the same roster gone and the cadence intact. Module store, no entity
// dependency → default 'post' phase.

import { registerSaveHandler } from '../../save/registry'
import {
  snapshotCivilianChurn, restoreCivilianChurn, resetCivilianChurn,
  type CivilianChurnSnapshot,
} from '../../sim/civilianChurnState'

registerSaveHandler<CivilianChurnSnapshot>({
  id: 'civilianChurn',
  snapshot: () => {
    const snap = snapshotCivilianChurn()
    // Nothing happens pre-war; skip the write until the first churn touches
    // state so legacy/pre-war bundles stay clean.
    if (snap.churned.length === 0 && snap.lastRollDay === 0) return undefined
    return snap
  },
  restore: (blob) => restoreCivilianChurn(blob),
  reset: () => resetCivilianChurn(),
})
