// Diplomatic-slot occupancy state (Phase 7.0.E.4) — which faction occupies
// each city slot plus the stable EntityKeys of the staff + guard NPCs that
// belong to it. A sim-layer module store (mirroring sim/conscriptionState.ts /
// sim/civilianChurnState.ts): global, not a per-scene ECS trait.
//
// The slot ANCHOR entities are re-derived at bootstrap from scenes.json5, so
// they aren't persisted here. The occupant + its runtime-spawned staff/guard
// NPCs are: on load the occupancy system re-spawns them at the anchor from this
// record (the world save-diff would otherwise destroy reset-unknown entities —
// see src/save/index.ts), so the restored map is the authoritative source for
// re-materializing them.

import { create } from 'zustand'

export interface SlotOccupancy {
  slotId: string
  factionId: string
  // Stable EntityKeys of the staff + guard NPCs assigned to this slot.
  staffKeys: string[]
  guardKeys: string[]
}

interface DiplomaticSlotStateData {
  // slotId → occupancy record. Absent = free.
  bySlot: Record<string, SlotOccupancy>
  // Monotonic counter for minting unique staff/guard EntityKeys.
  nextSeq: number
  // Count of player-eject episodes (one per detection entry). The guard BT
  // increments this when it warns + force-walks a hostile player; the smoke
  // reads it to prove the eject fired without depending on the UI toast layer.
  ejectCount: number
}

const EMPTY: DiplomaticSlotStateData = { bySlot: {}, nextSeq: 1, ejectCount: 0 }

export const useDiplomaticSlots = create<DiplomaticSlotStateData>(() => ({ ...EMPTY, bySlot: {} }))

export function recordEjection(): void {
  useDiplomaticSlots.setState((s) => ({ ejectCount: s.ejectCount + 1 }))
}

export function getEjectCount(): number {
  return useDiplomaticSlots.getState().ejectCount
}

export function getOccupancy(slotId: string): SlotOccupancy | null {
  return useDiplomaticSlots.getState().bySlot[slotId] ?? null
}

export function isSlotFree(slotId: string): boolean {
  return useDiplomaticSlots.getState().bySlot[slotId] === undefined
}

export function factionOccupiesAnySlot(factionId: string): boolean {
  return Object.values(useDiplomaticSlots.getState().bySlot).some((o) => o.factionId === factionId)
}

export function allOccupancies(): SlotOccupancy[] {
  return Object.values(useDiplomaticSlots.getState().bySlot)
}

// Mint a run of unique sequence numbers (one per entity key needed) so staff
// and guard keys never collide across occupy cycles or save reloads.
export function takeSeq(count: number): number[] {
  const start = useDiplomaticSlots.getState().nextSeq
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push(start + i)
  useDiplomaticSlots.setState({ nextSeq: start + count })
  return out
}

export function setOccupancy(occ: SlotOccupancy): void {
  useDiplomaticSlots.setState((s) => ({ bySlot: { ...s.bySlot, [occ.slotId]: occ } }))
}

export function clearOccupancy(slotId: string): void {
  useDiplomaticSlots.setState((s) => {
    const next = { ...s.bySlot }
    delete next[slotId]
    return { bySlot: next }
  })
}

// ── Persistence ────────────────────────────────────────────────────────────

export interface DiplomaticSlotSnapshot {
  bySlot: Record<string, SlotOccupancy>
  nextSeq: number
}

export function snapshotDiplomaticSlots(): DiplomaticSlotSnapshot {
  const s = useDiplomaticSlots.getState()
  return { bySlot: { ...s.bySlot }, nextSeq: s.nextSeq }
}

export function restoreDiplomaticSlots(blob: DiplomaticSlotSnapshot): void {
  useDiplomaticSlots.setState({
    bySlot: { ...(blob.bySlot ?? {}) },
    nextSeq: blob.nextSeq ?? 1,
  })
}

export function resetDiplomaticSlots(): void {
  useDiplomaticSlots.setState({ ...EMPTY, bySlot: {} })
}
