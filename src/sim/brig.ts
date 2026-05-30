// Phase 6.2 / Issue #70 — flagship brig: the single source of truth for
// captured POWs. The store is pure data (no systems imports — it sits in
// the sim layer); the per-prisoner verbs (interrogate / ransom / recruit
// / execute / hand-over / release) and the brig-condition upkeep tick
// live in src/systems/prisoners.ts, which writes back through this store.
//
// The brig store backs three surfaces from ONE record set: the named-POW
// reveal panel in the post-combat tally, the brig walk-up verb wall
// (BrigPanel), and the captain's-office comm-panel face wall
// (CommPanelDialog). All three read `prisoners`; all verb writes route
// through systems/prisoners.ts so there is one verb implementation.

import { create } from 'zustand'
import { getWorld } from '../ecs/world'
import { Ship, IsFlagshipMark } from '../ecs/traits'
import { getShipClass } from '../data/ship-classes'

// One captured POW. Identified by `id` (special-NPC id for named
// hostiles, or a generated `pow-…` id for anonymous pod crew) so save
// round-trip references a stable key; `nameZh` / `titleZh` / `contextZh`
// are denormalized for the tally + brig panels (so opening either panel
// doesn't depend on a lookup that could lose the named NPC across a
// future content reshuffle).
export interface PrisonerRecord {
  id: string
  nameZh: string
  titleZh?: string
  contextZh: string
  factionId: string
  // Epoch-ms timestamp of capture (simNow()).
  capturedAtMs: number
  // Issue #70 — EntityKey of the prisoner's Character entity in the
  // playerShipInterior world. The entity carries the Conditions trait the
  // shared physiology pipeline ticks for brig-condition death. Empty
  // string for legacy 6.2 capture records (named-hostile-only) that
  // pre-date the entity-backed flow; the brig tick skips those.
  entityKey: string
  // Issue #70 — brig provisioning level (0..100): food / water / medical
  // access. Decays per brig tick; below the configured floor onsets the
  // brig_neglect condition on the prisoner entity.
  provision: number
}

interface BrigState {
  prisoners: PrisonerRecord[]
  // Per-fight queue — startCombat clears, endCombat reads. Surfaces the
  // tally panel's "captured this engagement" right column.
  pendingTally: PrisonerRecord[]
  add: (rec: PrisonerRecord) => boolean
  // Issue #70 — remove a prisoner by id (verb resolution / death / escape).
  removeById: (id: string) => PrisonerRecord | null
  // Issue #70 — write back a prisoner's provisioning level.
  setProvision: (id: string, provision: number) => void
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

// Read the flagship's brigCapacity. Returns 0 when no flagship exists yet
// (boot order quirk; brig.add called before ship bootstrap should refuse
// rather than throw).
export function getBrigCapacity(): number {
  const w = getWorld(SHIP_SCENE_ID)
  const ent = w.queryFirst(Ship, IsFlagshipMark)
  if (!ent) return 0
  const s = ent.get(Ship)!
  if (!s.templateId) return 0
  return getShipClass(s.templateId).brigCapacity
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
  removeById: (id) => {
    const found = get().prisoners.find((p) => p.id === id) ?? null
    if (!found) return null
    set((s) => ({
      prisoners: s.prisoners.filter((p) => p.id !== id),
      pendingTally: s.pendingTally.filter((p) => p.id !== id),
    }))
    return found
  },
  setProvision: (id, provision) => {
    set((s) => ({
      prisoners: s.prisoners.map((p) => (p.id === id ? { ...p, provision } : p)),
    }))
  },
  clearPendingTally: () => set({ pendingTally: [] }),
  reset: () => set({ prisoners: [], pendingTally: [] }),
  serialize: () => ({ prisoners: get().prisoners.slice() }),
  hydrate: (snap) => {
    if (!snap) {
      set({ prisoners: [], pendingTally: [] })
      return
    }
    // Backfill new fields for legacy 6.2 save blobs.
    const prisoners = snap.prisoners.map((p) => ({
      ...p,
      entityKey: p.entityKey ?? '',
      provision: p.provision ?? 100,
    }))
    set({ prisoners, pendingTally: [] })
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
  const ent = w.queryFirst(Ship, IsFlagshipMark)
  if (!ent) return { occupied: useBrig.getState().prisoners.length, capacity: 0 }
  const s = ent.get(Ship)!
  if (!s.templateId) return { occupied: useBrig.getState().prisoners.length, capacity: 0 }
  return {
    occupied: useBrig.getState().prisoners.length,
    capacity: getShipClass(s.templateId).brigCapacity,
  }
}
