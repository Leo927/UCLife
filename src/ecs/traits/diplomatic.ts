// Phase 7.0.E.4 — diplomatic-slot traits.
//
// DiplomaticSlot — a generic city "slot" anchor entity, one per scenes.json5
// `diplomaticSlots[]` entry. Spawned at bootstrap at the slot's anchorTile.
// `occupantFaction` is '' while free; the occupancy system sets it to the
// occupying faction id (and back to '' on vacate). Carries the slot geometry
// (tile-space rect + exit tile) so guards can read their post's restricted
// area off their own slot without a scene-config lookup.
//
// Guard — stamped on a guard NPC the occupancy system spawns for an occupied
// slot. The NPC behavior tree's highest-priority branch is gated on
// `entity.has(Guard)`, so ordinary NPCs never run the eject logic. `rect` is
// the restricted area (tile-space) the guard watches; `detectRadiusPx` is the
// pixel proximity gate; `slotId` ties the guard back to its slot for vacate.

import { trait } from 'koota'

export const DiplomaticSlot = trait({
  slotId: '',
  occupantFaction: '',
  rectX: 0,
  rectY: 0,
  rectW: 0,
  rectH: 0,
  anchorX: 0,
  anchorY: 0,
  exitX: 0,
  exitY: 0,
})

export const Guard = trait({
  faction: '',
  slotId: '',
  detectRadiusPx: 0,
  // Restricted-area rect in tile-space (mirrors the slot's rect).
  rectX: 0,
  rectY: 0,
  rectW: 0,
  rectH: 0,
  // Slot anchor in pixel-space — the post the guard holds at / returns to.
  anchorX: 0,
  anchorY: 0,
  // Slot exit in pixel-space — where an ejected hostile player is force-walked.
  exitX: 0,
  exitY: 0,
  // Per-detection-episode debounce: true while the current hostile player is
  // still inside the rect, so the warn toast only fires once per entry.
  ejecting: false,
})
