// Phase 6.2 — flagship brig: named-POW capture record + capacity gating.
// Per-prisoner verbs (interrogate / ransom / recruit / execute / hand-over
// / release) and brig-condition upkeep land at 6.2.5; this phase only
// tracks who's aboard and whether there's room for one more.
//
// The brig store is the source of truth for the named POW reveal panel in
// the post-combat tally + the comm-panel face wall in the captain's
// office. Anonymous crew counts ride on the per-POW row's `crewCount`;
// for 6.2 capture only fires on named hostiles and the crewCount field
// stays zero.

import { create } from 'zustand'
import { getWorld } from '../ecs/world'
import { Ship } from '../ecs/traits'
import { getShipClass } from '../data/ships'

// One captured POW. Identified by the special-NPC id so save round-trip
// references the canonical character; `nameZh` / `titleZh` / `contextZh`
// are denormalized for the tally + brig panels (so opening either panel
// doesn't depend on a lookup that could lose the named NPC across a
// future content reshuffle).
export interface PrisonerRecord {
  id: string
  nameZh: string
  titleZh?: string
  contextZh: string
  factionId: string
  // Real-ms timestamp of capture (performance.now()) so the tally panel
  // can display "captured 此战 just now" vs. "earlier"; 6.2 doesn't
  // surface this yet but the save shape keeps it for 6.2.5+.
  capturedAtMs: number
}

interface BrigState {
  prisoners: PrisonerRecord[]
  // Per-fight queue — startCombat clears, endCombat reads. Surfaces the
  // tally panel's "captured this engagement" right column.
  pendingTally: PrisonerRecord[]
  add: (rec: PrisonerRecord) => boolean
  clearPendingTally: () => void
  reset: () => void
  // Save handler entry points.
  serialize: () => SerializedBrig
  hydrate: (snap: SerializedBrig | null) => void
}

export interface SerializedBrig {
  prisoners: PrisonerRecord[]
}

const SHIP_SCENE_ID = 'playerShipInterior'

// Read the current ship class's brigCapacity. Returns 0 when no ship
// singleton exists yet (boot order quirk; brig.add called before ship
// bootstrap should refuse rather than throw).
export function getBrigCapacity(): number {
  const w = getWorld(SHIP_SCENE_ID)
  const ent = w.queryFirst(Ship)
  if (!ent) return 0
  const s = ent.get(Ship)!
  if (!s.classId) return 0
  return getShipClass(s.classId).brigCapacity
}

export const useBrig = create<BrigState>((set, get) => ({
  prisoners: [],
  pendingTally: [],
  add: (rec) => {
    const cap = getBrigCapacity()
    const cur = get().prisoners.length
    if (cur >= cap) return false
    if (get().prisoners.some((p) => p.id === rec.id)) return false
    set((s) => ({
      prisoners: [...s.prisoners, rec],
      pendingTally: [...s.pendingTally, rec],
    }))
    return true
  },
  clearPendingTally: () => set({ pendingTally: [] }),
  reset: () => set({ prisoners: [], pendingTally: [] }),
  serialize: () => ({ prisoners: get().prisoners.slice() }),
  hydrate: (snap) => {
    if (!snap) {
      set({ prisoners: [], pendingTally: [] })
      return
    }
    set({ prisoners: snap.prisoners.slice(), pendingTally: [] })
  },
}))

// Convenience: also called by startCombat so a fresh engagement clears
// the "captured this fight" queue without nuking the brig roster.
export function clearBrigPendingTally(): void {
  useBrig.getState().clearPendingTally()
}

// Lookup helper for the comm-panel dialog — current brig occupancy /
// capacity in one tuple.
export function getBrigOccupancy(): { occupied: number; capacity: number } {
  const w = getWorld(SHIP_SCENE_ID)
  const ent = w.queryFirst(Ship)
  if (!ent) return { occupied: useBrig.getState().prisoners.length, capacity: 0 }
  const s = ent.get(Ship)!
  if (!s.classId) return { occupied: useBrig.getState().prisoners.length, capacity: 0 }
  return {
    occupied: useBrig.getState().prisoners.length,
    capacity: getShipClass(s.classId).brigCapacity,
  }
}
