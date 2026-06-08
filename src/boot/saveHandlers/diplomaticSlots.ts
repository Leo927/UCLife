// Phase 7.0.E.4 — persists diplomatic-slot occupancy: which faction holds each
// slot plus the stable EntityKeys of its staff + guards, the key sequence
// counter, and the eject count. On restore the occupancy map is reloaded and
// the slot personnel are re-spawned at their anchors (the world save-diff
// destroys reset-unknown entities, so the map is the authoritative source for
// re-materializing the `dipl-*` staff/guards). Module store, no entity
// dependency for the snapshot → default 'post' phase (after entity overlay, so
// the slot anchors exist when rematerializeOccupancies runs).

import { registerSaveHandler } from '../../save/registry'
import {
  snapshotDiplomaticSlots, restoreDiplomaticSlots, resetDiplomaticSlots,
  type DiplomaticSlotSnapshot,
} from '../../sim/diplomaticSlotState'
import { rematerializeOccupancies } from '../../systems/diplomaticSlots'

registerSaveHandler<DiplomaticSlotSnapshot>({
  id: 'diplomaticSlots',
  snapshot: () => {
    const snap = snapshotDiplomaticSlots()
    // Nothing to persist until a slot has been occupied. Keep pre-war / legacy
    // bundles clean.
    if (Object.keys(snap.bySlot).length === 0 && snap.nextSeq === 1) return undefined
    return snap
  },
  restore: (blob) => {
    restoreDiplomaticSlots(blob)
    rematerializeOccupancies()
  },
  reset: () => resetDiplomaticSlots(),
})
