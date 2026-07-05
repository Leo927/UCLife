// Task 8 (W1 playable-loop) — ship <-> depot MS custody. Closes the
// frame-mod retrofit catch-22: the starter MS arrives aboard the flagship
// (W1 Task 5/7), but frame-mod install is gated on the MS being at a depot
// (dockedAtPoiId set — see MsRetrofitPanel.tsx's `atDepot`), and there was
// no verb to move it there. unloadMsToDepot / loadMsAboard are the two
// halves of that move, parallel to msTransfer.ts's POI<->POI transfer but
// on the orthogonal ship<->depot axis — same custody invariant on `Ms`
// (exactly one of storedOnShipKey / dockedAtPoiId non-empty at rest).
//
// Capacity gating differs by direction, per the data model that already
// exists:
//   - Depot side (unload): receiveMsDelivery (msDelivery.ts) only gates MS
//     storage on hangar *capability* (does the hangar advertise an
//     MS-fitting slot class at all, via fittingSlotClasses) — occupancy is
//     explicitly NOT counted against a per-slot quota today (see that
//     file's comment: "Occupancy is read for parity / future per-slot
//     quotas; not gating today"). unloadMsToDepot mirrors that exact gate
//     rather than inventing a new depot capacity system.
//   - Ship side (load): the ship's `hangarCapacity` stat IS a real,
//     enforced per-ship cap (lightFreighter ships with hangarCapacity: 1,
//     "机库勉强能容下一台 MS" — see ship-classes.json5). loadMsAboard counts
//     current occupants via countMsAboard and refuses when the bay is full.
//
// "Mid-sortie" gate: no per-MS entity carries a flag for "currently
// deployed in a tactical engagement" — the tactical clone spawned by
// launchMs (sim/cockpit.ts) is a *separate* entity keyed PLAYER_MS_KEY with
// no back-reference to the persistent Ms entity's key. Absent that data,
// this module treats `useClock().mode === 'combat'` as the conservative
// proxy: custody verbs are unreachable via the interaction system whenever
// combat is engaged anyway (the player is in the tactical cockpit, not
// walking a hangar), so gating on clock mode costs nothing today and errs
// safe rather than allowing a custody flip mid-engagement.

import type { Entity } from 'koota'
import {
  Ms, Ship, ShipStatSheet, Hangar, Owner, EntityKey,
} from '../ecs/traits'
import { getWorld } from '../ecs/world'
import { getStat } from '../stats/sheet'
import { computeMsDamageState } from '../ecs/msDamage'
import { getMsClass } from '../data/ms'
import { getShipClass } from '../data/ship-classes'
import { fittingSlotClasses } from '../data/facilityTypes'
import { findHangarAtPoi } from './hangarQuery'
import { listMsTransferableAtPoi } from './msTransfer'
import { refreshMsLayout, refreshAllDepotMsLayouts } from '../ecs/spawn'
import { useClock } from '../sim/clock'
import { emitSim } from '../sim/events'
import { simNow } from '../sim/time'

const SHIP_SCENE_ID = 'playerShipInterior' as const

export type MsCustodyResult = { ok: true } | { ok: false; reasonZh: string }

export interface CustodyMsRow {
  msKey: string
  templateId: string
  msName: string
}

export interface CustodyShipRow {
  shipKey: string
  templateId: string
  shipName: string
  hangarCapacity: number
  freeBays: number
}

function findMsByKey(msKey: string): Entity | null {
  const w = getWorld(SHIP_SCENE_ID)
  for (const ent of w.query(Ms, EntityKey)) {
    if (ent.get(EntityKey)!.key === msKey) return ent
  }
  return null
}

function findShipByKey(shipKey: string): Entity | null {
  const w = getWorld(SHIP_SCENE_ID)
  for (const ent of w.query(Ship, EntityKey)) {
    if (ent.get(EntityKey)!.key === shipKey) return ent
  }
  return null
}

// See module doc — no per-MS "currently sortied" flag exists; combat mode
// is the conservative proxy.
function isMidSortieOrTransit(ms: { transitDestinationId: string }): boolean {
  if (ms.transitDestinationId !== '') return true
  if (useClock.getState().mode === 'combat') return true
  return false
}

export function countMsAboard(shipKey: string): number {
  if (!shipKey) return 0
  const w = getWorld(SHIP_SCENE_ID)
  let n = 0
  for (const ent of w.query(Ms)) {
    if (ent.get(Ms)!.storedOnShipKey === shipKey) n += 1
  }
  return n
}

function hangarHasMsSlotAtPoi(poiId: string): boolean {
  const hangar = findHangarAtPoi(poiId)
  if (!hangar) return false
  const h = hangar.get(Hangar)
  if (!h) return false
  return fittingSlotClasses(h.slotCapacity, 'ms').length > 0
}

// Ship-side hangar bay index this MS should occupy — the lowest index not
// already claimed by another MS stored aboard the same ship. Mirrors the
// occupancy-derivation shape used elsewhere (deriveHangarOccupancy) at a
// much smaller scale (a handful of bays per ship).
function nextFreeBayIndex(shipKey: string, capacity: number): number {
  const used = new Set<number>()
  const w = getWorld(SHIP_SCENE_ID)
  for (const ent of w.query(Ms)) {
    const m = ent.get(Ms)!
    if (m.storedOnShipKey === shipKey) used.add(m.bayIndex)
  }
  for (let i = 0; i < capacity; i += 1) {
    if (!used.has(i)) return i
  }
  return 0
}

// Move an MS from its host ship's hangar bay to the depot hangar at
// `poiId`. Refuses unless the host ship is docked at that exact POI, the
// MS isn't mid-sortie/in-transit, and the depot hangar advertises an
// MS-fitting slot class (capability gate — see module doc; depot MS
// storage has no occupancy quota today).
export function unloadMsToDepot(msKey: string, poiId: string): MsCustodyResult {
  const msEnt = findMsByKey(msKey)
  if (!msEnt) return { ok: false, reasonZh: 'MS 数据异常' }
  const ms = msEnt.get(Ms)!

  if (isMidSortieOrTransit(ms)) {
    return { ok: false, reasonZh: 'MS 正在执行任务或调度中' }
  }
  const hostShipKey = ms.storedOnShipKey
  if (!hostShipKey) return { ok: false, reasonZh: '该 MS 未装载于任何飞船' }

  const hostShip = findShipByKey(hostShipKey)
  if (!hostShip) return { ok: false, reasonZh: '宿主飞船数据异常' }
  if (hostShip.get(Ship)!.dockedAtPoiId !== poiId) {
    return { ok: false, reasonZh: '飞船尚未泊靠该坐标' }
  }
  if (!hangarHasMsSlotAtPoi(poiId)) {
    return { ok: false, reasonZh: '该机库没有 MS 泊位' }
  }

  // Task 9 — landing at a depot may flip a damaged MS's damageState into
  // 'in-repair' (it was 'ready'-with-deficit while still aboard the ship).
  const unloaded = { ...ms, storedOnShipKey: '', dockedAtPoiId: poiId }
  msEnt.set(Ms, { ...unloaded, damageState: computeMsDamageState(unloaded) })
  refreshMsLayout()
  refreshAllDepotMsLayouts()
  emitSim('log', { textZh: 'MS 已卸运至地面机库', atMs: simNow() })
  return { ok: true }
}

// Move an MS from a depot's hangar (parked via dockedAtPoiId) aboard a ship
// docked at the same POI. Refuses unless the MS is actually parked at a
// depot, the target ship is docked at that same POI, and the ship's
// hangarCapacity stat has a free bay (real, enforced per-ship cap — see
// module doc).
export function loadMsAboard(msKey: string, shipKey: string): MsCustodyResult {
  const msEnt = findMsByKey(msKey)
  if (!msEnt) return { ok: false, reasonZh: 'MS 数据异常' }
  const ms = msEnt.get(Ms)!

  if (isMidSortieOrTransit(ms)) {
    return { ok: false, reasonZh: 'MS 正在执行任务或调度中' }
  }
  const poiId = ms.dockedAtPoiId
  if (!poiId) return { ok: false, reasonZh: 'MS 未停放于任何机库' }

  const shipEnt = findShipByKey(shipKey)
  if (!shipEnt) return { ok: false, reasonZh: '目标飞船不存在' }
  const ship = shipEnt.get(Ship)!
  if (ship.dockedAtPoiId !== poiId) {
    return { ok: false, reasonZh: '飞船未泊靠于 MS 所在机库' }
  }

  const sheet = shipEnt.get(ShipStatSheet)?.sheet
  const capacity = sheet ? Math.floor(getStat(sheet, 'hangarCapacity')) : 0
  if (capacity <= 0 || countMsAboard(shipKey) >= capacity) {
    return { ok: false, reasonZh: '飞船机库已满' }
  }

  const bayIndex = nextFreeBayIndex(shipKey, capacity)
  // Task 9 — loading aboard drops out of depot custody, so a damaged MS
  // reverts to 'ready'-with-deficit (no repair crew works on it at sea).
  const loaded = { ...ms, storedOnShipKey: shipKey, dockedAtPoiId: '', bayIndex }
  msEnt.set(Ms, { ...loaded, damageState: computeMsDamageState(loaded) })
  refreshMsLayout()
  refreshAllDepotMsLayouts()
  emitSim('log', { textZh: 'MS 已装载上舰', atMs: simNow() })
  return { ok: true }
}

// MS aboard a player-owned ship docked at `poiId` — the unload verb's
// candidate list. Excludes in-transit/mid-sortie MS the same way the
// mutator itself refuses them.
export function listShipAboardMsAtPoi(poiId: string): CustodyMsRow[] {
  const shipWorld = getWorld(SHIP_SCENE_ID)
  const dockedShipKeys = new Set<string>()
  for (const ent of shipWorld.query(Ship, Owner, EntityKey)) {
    const s = ent.get(Ship)!
    if (s.dockedAtPoiId !== poiId) continue
    if (ent.get(Owner)!.kind !== 'character') continue
    dockedShipKeys.add(ent.get(EntityKey)!.key)
  }
  const out: CustodyMsRow[] = []
  for (const ent of shipWorld.query(Ms, EntityKey)) {
    const ms = ent.get(Ms)!
    if (!ms.storedOnShipKey || !dockedShipKeys.has(ms.storedOnShipKey)) continue
    if (isMidSortieOrTransit(ms)) continue
    const cls = getMsClass(ms.templateId)
    out.push({ msKey: ent.get(EntityKey)!.key, templateId: ms.templateId, msName: cls.nameZh })
  }
  return out
}

// Depot MS parked at `poiId` (not aboard any ship, not in transit) — the
// load verb's MS candidate list. Reuses msTransfer.ts's existing query
// rather than forking it; same shape this module needs.
export function listDepotMsAtPoi(poiId: string): CustodyMsRow[] {
  return listMsTransferableAtPoi(poiId)
}

// Player-owned ships docked at `poiId` with at least one free hangar bay —
// the load verb's ship candidate list.
export function listShipsWithFreeBaysAtPoi(poiId: string): CustodyShipRow[] {
  const shipWorld = getWorld(SHIP_SCENE_ID)
  const out: CustodyShipRow[] = []
  for (const ent of shipWorld.query(Ship, ShipStatSheet, Owner, EntityKey)) {
    const s = ent.get(Ship)!
    if (s.dockedAtPoiId !== poiId) continue
    if (s.transitDestinationId) continue
    if (ent.get(Owner)!.kind !== 'character') continue
    const shipKey = ent.get(EntityKey)!.key
    const sheet = ent.get(ShipStatSheet)!.sheet
    const capacity = Math.floor(getStat(sheet, 'hangarCapacity'))
    const free = capacity - countMsAboard(shipKey)
    if (free <= 0) continue
    const cls = getShipClass(s.templateId)
    out.push({
      shipKey, templateId: s.templateId, shipName: cls.nameZh, hangarCapacity: capacity, freeBays: free,
    })
  }
  return out
}
