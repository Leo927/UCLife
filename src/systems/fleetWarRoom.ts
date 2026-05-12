// Phase 6.2.E1 — war-room plot-table composition surface (ECS layer).
//
// Pure ECS operations the war-room panel (and smoke) call into. The UI
// owns the rendering; this module owns the rules:
//   - Flagship is always in the active fleet at the configured center
//     slot. Cannot be moved to reserve. Cannot share a slot.
//   - Non-flagship ships toggle in/out of active via setIsInActiveFleet.
//     Promotion picks a free slot if `targetSlot` is omitted.
//   - setFormationSlot moves an already-active ship; rejects collisions
//     against the flagship slot and against another active ship's slot.
//   - setAggression updates the doctrine field directly; rejected if
//     the requested level isn't in fleet.json5's aggressionLevels list.
//
// Save/load: the Ship trait already round-trips `aggression` +
// `formationSlot`; the ship save handler round-trips the IsInActiveFleet
// marker. No new save handler.

import type { Entity } from 'koota'
import { Ship, IsFlagshipMark, IsInActiveFleet, EntityKey } from '../ecs/traits'
import { getWorld } from '../ecs/world'
import { fleetConfig } from '../config'
import { getShipClass } from '../data/ship-classes'

const SHIP_SCENE_ID = 'playerShipInterior'

export type Aggression = string

export interface WarRoomShipRow {
  entityKey: string
  shipName: string
  templateId: string
  isFlagship: boolean
  isInActiveFleet: boolean
  formationSlot: number
  aggression: Aggression
}

export interface WarRoomSnapshot {
  cols: number
  rows: number
  flagshipSlot: number
  ships: WarRoomShipRow[]
  // Convenience flattening: slot index → ship key (or empty if free).
  // The flagship's slot is always occupied; -1 (reserve) entries are
  // not surfaced here.
  occupancy: Record<number, string>
}

function findShipEntByKey(shipKey: string): Entity | null {
  const w = getWorld(SHIP_SCENE_ID)
  for (const e of w.query(Ship, EntityKey)) {
    if (e.get(EntityKey)!.key === shipKey) return e
  }
  return null
}

export function warRoomDescribe(): WarRoomSnapshot {
  const grid = fleetConfig.activeFleetGrid
  const ships: WarRoomShipRow[] = []
  const occupancy: Record<number, string> = {}
  const w = getWorld(SHIP_SCENE_ID)
  for (const e of w.query(Ship, EntityKey)) {
    const s = e.get(Ship)!
    const key = e.get(EntityKey)!.key
    const cls = getShipClass(s.templateId)
    const active = e.has(IsInActiveFleet)
    const row: WarRoomShipRow = {
      entityKey: key,
      shipName: cls.nameZh,
      templateId: s.templateId,
      isFlagship: e.has(IsFlagshipMark),
      isInActiveFleet: active,
      formationSlot: s.formationSlot,
      aggression: s.aggression,
    }
    ships.push(row)
    if (active && s.formationSlot >= 0) {
      occupancy[s.formationSlot] = key
    }
  }
  return {
    cols: grid.cols,
    rows: grid.rows,
    flagshipSlot: grid.flagshipSlot,
    ships,
    occupancy,
  }
}

// Pick the first free slot on the grid. Returns -1 only when every slot
// is taken — the grid is sized so early-fleet scale doesn't hit this.
function firstFreeSlot(occupancy: Record<number, string>): number {
  const grid = fleetConfig.activeFleetGrid
  const total = grid.cols * grid.rows
  for (let i = 0; i < total; i++) {
    if (occupancy[i]) continue
    return i
  }
  return -1
}

export type WarRoomFailReason =
  | 'ship_not_found'
  | 'flagship_locked'
  | 'no_free_slot'
  | 'slot_out_of_range'
  | 'slot_occupied'
  | 'invalid_aggression'

export type WarRoomResult =
  | { ok: true; entityKey: string; formationSlot: number }
  | { ok: false; reason: WarRoomFailReason }

// Promote a reserve ship into the active fleet at the requested slot
// (or first free slot if omitted). Demoting (active=false) is forbidden
// on the flagship. Otherwise idempotent: re-promoting an active ship
// to a different slot is allowed (caller can also use setFormationSlot
// for the rearrangement).
export function setIsInActiveFleet(
  shipKey: string,
  active: boolean,
  targetSlot?: number,
): WarRoomResult {
  const ent = findShipEntByKey(shipKey)
  if (!ent) return { ok: false, reason: 'ship_not_found' }
  const s = ent.get(Ship)!
  // Flagship: refuse to demote; promotion is a no-op (it's always in).
  if (ent.has(IsFlagshipMark)) {
    if (!active) return { ok: false, reason: 'flagship_locked' }
    return { ok: true, entityKey: shipKey, formationSlot: s.formationSlot }
  }
  if (!active) {
    // Demote: clear marker + drop slot.
    if (ent.has(IsInActiveFleet)) ent.remove(IsInActiveFleet)
    ent.set(Ship, { ...s, formationSlot: -1 })
    return { ok: true, entityKey: shipKey, formationSlot: -1 }
  }
  // Promote — resolve a slot.
  const snap = warRoomDescribe()
  const occupancy = { ...snap.occupancy }
  // If the ship is already active at some slot, vacate it so it can
  // re-bid against the same map.
  if (s.formationSlot >= 0 && occupancy[s.formationSlot] === shipKey) {
    delete occupancy[s.formationSlot]
  }
  const grid = fleetConfig.activeFleetGrid
  let slot = targetSlot ?? -1
  if (slot < 0) {
    slot = firstFreeSlot(occupancy)
    if (slot < 0) return { ok: false, reason: 'no_free_slot' }
  } else {
    const total = grid.cols * grid.rows
    if (slot >= total) return { ok: false, reason: 'slot_out_of_range' }
    if (slot === grid.flagshipSlot) return { ok: false, reason: 'slot_occupied' }
    if (occupancy[slot]) return { ok: false, reason: 'slot_occupied' }
  }
  if (!ent.has(IsInActiveFleet)) ent.add(IsInActiveFleet)
  ent.set(Ship, { ...s, formationSlot: slot })
  return { ok: true, entityKey: shipKey, formationSlot: slot }
}

// Move an already-active ship to a different slot. Rejects on collisions
// and on the flagship's anchor slot. To demote a ship, use
// setIsInActiveFleet(shipKey, false).
export function setFormationSlot(
  shipKey: string,
  targetSlot: number,
): WarRoomResult {
  const ent = findShipEntByKey(shipKey)
  if (!ent) return { ok: false, reason: 'ship_not_found' }
  const grid = fleetConfig.activeFleetGrid
  const total = grid.cols * grid.rows
  if (targetSlot < 0 || targetSlot >= total) return { ok: false, reason: 'slot_out_of_range' }
  // Flagship is anchored — moving its slot is forbidden.
  if (ent.has(IsFlagshipMark)) {
    if (targetSlot === grid.flagshipSlot) {
      return { ok: true, entityKey: shipKey, formationSlot: targetSlot }
    }
    return { ok: false, reason: 'flagship_locked' }
  }
  // Non-flagship: must already be active to reposition.
  if (!ent.has(IsInActiveFleet)) return { ok: false, reason: 'slot_out_of_range' }
  if (targetSlot === grid.flagshipSlot) return { ok: false, reason: 'slot_occupied' }
  const snap = warRoomDescribe()
  const occ = snap.occupancy[targetSlot]
  if (occ && occ !== shipKey) return { ok: false, reason: 'slot_occupied' }
  const s = ent.get(Ship)!
  ent.set(Ship, { ...s, formationSlot: targetSlot })
  return { ok: true, entityKey: shipKey, formationSlot: targetSlot }
}

export type SetAggressionResult =
  | { ok: true; aggression: Aggression }
  | { ok: false; reason: 'ship_not_found' | 'invalid_aggression' }

export function setAggression(shipKey: string, aggression: string): SetAggressionResult {
  const ent = findShipEntByKey(shipKey)
  if (!ent) return { ok: false, reason: 'ship_not_found' }
  const valid = fleetConfig.aggressionLevels.some((a) => a.id === aggression)
  if (!valid) return { ok: false, reason: 'invalid_aggression' }
  const s = ent.get(Ship)!
  ent.set(Ship, { ...s, aggression })
  return { ok: true, aggression }
}

// Convenience: list every owned ship as a war-room row. Used by the
// FleetRosterPanel's read-only active/reserve column + aggression column
// (the verb lives at the war room).
export function warRoomShipRows(): WarRoomShipRow[] {
  return warRoomDescribe().ships
}
