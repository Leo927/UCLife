// Phase 7.0.E.4 — trait serializers for the diplomatic-slot anchors and guards.
//
// DiplomaticSlot — the slot anchor is re-derived at bootstrap (stable
// `slot-<scene>-<id>` key), so its geometry is already correct on load; the
// serializer overlays only the runtime `occupantFaction` so a restored anchor
// reads as occupied/free correctly even before the occupancy handler re-runs.
//
// Guard — slot guards are re-spawned by the diplomaticSlots save handler from
// the persisted occupancy map (the world save-diff would otherwise drop them).
// The serializer round-trips the Guard payload for the case where a guard
// entity IS present in the snapshot, keeping the eject-debounce latch + post
// geometry intact.

import type { TraitInstance } from 'koota'
import { registerTraitSerializer } from '../../save/traitRegistry'
import { DiplomaticSlot, Guard } from '../../ecs/traits'

registerTraitSerializer<TraitInstance<typeof DiplomaticSlot>>({
  id: 'diplomaticSlot',
  trait: DiplomaticSlot,
  read: (e) => ({ ...e.get(DiplomaticSlot)! }),
  write: (e, v) => {
    if (e.has(DiplomaticSlot)) e.set(DiplomaticSlot, v)
    else e.add(DiplomaticSlot(v))
  },
  reset: (e) => { if (e.has(DiplomaticSlot)) e.remove(DiplomaticSlot) },
})

registerTraitSerializer<TraitInstance<typeof Guard>>({
  id: 'guard',
  trait: Guard,
  read: (e) => ({ ...e.get(Guard)! }),
  write: (e, v) => {
    if (e.has(Guard)) e.set(Guard, v)
    else e.add(Guard(v))
  },
  reset: (e) => { if (e.has(Guard)) e.remove(Guard) },
})
