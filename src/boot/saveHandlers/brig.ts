// Phase 6.2 / Issue #70 — flagship brig POW roster. Round-trips the
// PrisonerRecord list (id / name / faction / capturedAt / entityKey /
// provision). The prisoner's backing Character entity (which carries the
// brig-condition Conditions the physiology pipeline ticks) is persisted by
// the `npc` save handler, linked back here via PrisonerRecord.entityKey;
// hydrate() backfills the entityKey / provision fields for legacy blobs.

import { registerSaveHandler } from '../../save/registry'
import { useBrig, type SerializedBrig } from '../../sim/brig'

registerSaveHandler<SerializedBrig>({
  id: 'brig',
  snapshot: () => useBrig.getState().serialize(),
  restore: (block) => useBrig.getState().hydrate(block),
  reset: () => useBrig.getState().reset(),
})
