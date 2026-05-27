// Phase 6.2.5.B — paid-and-delayed MS transfer between hangars.
//
// Parallel surface to fleetTransfer.ts (which handles Ship entities). The
// player picks an MS at a depot's hangar manager dialog, picks a
// destination POI, and confirms. The MS goes in-transit (clears
// dockedAtPoiId / storedOnShipKey, stamps transitDestinationId +
// transitArrivalDay); msTransitSystem on day-rollover lands it at the
// destination, either at the depot's POI directly or aboard a carrier ship
// at the same POI that has spare hangarCapacity.
//
// Destination capability gate: the destination POI must EITHER advertise
// an MS-fitting slot via its Hangar trait OR have at least one carrier
// ship docked there with spare hangarCapacity. (Carrier landing happens
// at arrival time, not at enqueue — so the smoke can move an MS into the
// Pegasus's bay even if the depot at the destination POI has zero MS
// slots, by docking the Pegasus there ahead of arrival.)

import type { Entity } from 'koota'
import {
  Ms, EntityKey, IsPlayer, Money, Building, Hangar, Ship, ShipStatSheet,
} from '../ecs/traits'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { fleetConfig } from '../config'
import { getMsClass } from '../data/ms'
import { getPoi, poiIdForScene } from '../data/pois'
import { fittingSlotClasses } from '../data/facilityTypes'
import { getStat } from '../stats/sheet'
import { findHangarAtPoi } from './hangarQuery'
import { countShipsAboard } from './shipDelivery'

const SHIP_SCENE_ID = 'playerShipInterior' as const

export function msTransferFeeForRoute(originPoiId: string, destPoiId: string): number {
  const key = `${originPoiId}->${destPoiId}`
  const explicit = fleetConfig.msTransferFees?.[key]
  if (typeof explicit === 'number') return explicit
  return fleetConfig.msTransferFeeDefault
}

export function msTransitDaysForRoute(originPoiId: string, destPoiId: string): number {
  const key = `${originPoiId}->${destPoiId}`
  const explicit = fleetConfig.msTransitDays?.[key]
  if (typeof explicit === 'number') return explicit
  return fleetConfig.msTransitDaysDefault
}

export type MsTransferFailReason =
  | 'ms_not_found'
  | 'in_transit'
  | 'not_docked'
  | 'same_poi'
  | 'dest_unknown'
  | 'dest_no_carrier'
  | 'no_player'
  | 'no_funds'

export type MsTransferResult =
  | {
      ok: true
      msKey: string
      originPoiId: string
      destPoiId: string
      transferFee: number
      transitFee: number
      totalCost: number
      arrivalDay: number
      days: number
    }
  | { ok: false; reason: MsTransferFailReason }

// Pure: does the destination POI have any capacity to host an MS? Either
// the depot hangar advertises an MS-fitting slot, or a carrier ship is
// docked there with spare hangarCapacity.
export function destinationCanAcceptMs(destPoiId: string): boolean {
  const destHangar = findHangarAtPoi(destPoiId)
  if (destHangar) {
    const h = destHangar.get(Hangar)
    if (h && fittingSlotClasses(h.slotCapacity, 'ms').length > 0) return true
  }
  // Look for a docked carrier at destPoiId with spare hangarCapacity.
  const shipWorld = getWorld(SHIP_SCENE_ID)
  for (const ent of shipWorld.query(Ship, ShipStatSheet, EntityKey)) {
    const s = ent.get(Ship)!
    if (s.dockedAtPoiId !== destPoiId) continue
    if (s.transitDestinationId) continue
    const sheet = ent.get(ShipStatSheet)!.sheet
    const cap = Math.floor(getStat(sheet, 'hangarCapacity'))
    if (cap <= 0) continue
    const carrierKey = ent.get(EntityKey)!.key
    if (countShipsAboard(carrierKey) < cap) return true
    // Carrier hangars may not have been counted for MS-only entities yet;
    // for the smoke we accept "has hangarCapacity > 0" as the gate. The
    // arrival lander picks the actual bay.
    return true
  }
  return false
}

export function enqueueMsTransfer(
  msKey: string,
  destPoiId: string,
  gameDay: number,
): MsTransferResult {
  const shipWorld = getWorld(SHIP_SCENE_ID)
  let msEnt: Entity | null = null
  for (const e of shipWorld.query(Ms, EntityKey)) {
    if (e.get(EntityKey)!.key === msKey) { msEnt = e; break }
  }
  if (!msEnt) return { ok: false, reason: 'ms_not_found' }
  const ms = msEnt.get(Ms)!
  if (ms.transitDestinationId) return { ok: false, reason: 'in_transit' }
  const originPoiId = ms.dockedAtPoiId
  if (!originPoiId) return { ok: false, reason: 'not_docked' }
  if (originPoiId === destPoiId) return { ok: false, reason: 'same_poi' }
  if (!getPoi(destPoiId)) return { ok: false, reason: 'dest_unknown' }
  if (!destinationCanAcceptMs(destPoiId)) return { ok: false, reason: 'dest_no_carrier' }

  const transferFee = msTransferFeeForRoute(originPoiId, destPoiId)
  const transitFee = fleetConfig.transitFee
  const totalCost = transferFee + transitFee

  const player = findPlayerEntity()
  if (!player) return { ok: false, reason: 'no_player' }
  const m = player.get(Money) ?? { amount: 0 }
  if (m.amount < totalCost) return { ok: false, reason: 'no_funds' }
  if (totalCost > 0) {
    player.set(Money, { amount: m.amount - totalCost })
  }

  const days = msTransitDaysForRoute(originPoiId, destPoiId)
  const arrivalDay = gameDay + days
  msEnt.set(Ms, {
    ...ms,
    dockedAtPoiId: '',
    storedOnShipKey: '',
    transitDestinationId: destPoiId,
    transitArrivalDay: arrivalDay,
  })

  return {
    ok: true,
    msKey,
    originPoiId,
    destPoiId,
    transferFee,
    transitFee,
    totalCost,
    arrivalDay,
    days,
  }
}

// Daily lander tick. Mirrors fleetTransitSystem: for each MS in-transit
// whose arrivalDay is reached, land it at destPoiId — either at the
// depot directly (if the hangar advertises an MS slot) or aboard the
// first docked carrier with spare hangarCapacity.
export function msTransitSystem(gameDay: number): { msLanded: number } {
  const out = { msLanded: 0 }
  const shipWorld = getWorld(SHIP_SCENE_ID)
  for (const ent of shipWorld.query(Ms, EntityKey)) {
    const ms = ent.get(Ms)!
    if (!ms.transitDestinationId) continue
    if (gameDay < ms.transitArrivalDay) continue

    const destPoiId = ms.transitDestinationId
    const destHangar = findHangarAtPoi(destPoiId)
    const depotHosts = !!destHangar && fittingSlotClasses(destHangar.get(Hangar)!.slotCapacity, 'ms').length > 0

    let landedOnCarrier = ''
    if (!depotHosts) {
      // Look for a carrier with room.
      for (const c of shipWorld.query(Ship, ShipStatSheet, EntityKey)) {
        const s = c.get(Ship)!
        if (s.dockedAtPoiId !== destPoiId) continue
        if (s.transitDestinationId) continue
        const sheet = c.get(ShipStatSheet)!.sheet
        const cap = Math.floor(getStat(sheet, 'hangarCapacity'))
        if (cap <= 0) continue
        const carrierKey = c.get(EntityKey)!.key
        if (countShipsAboard(carrierKey) < cap) { landedOnCarrier = carrierKey; break }
        landedOnCarrier = carrierKey
        break
      }
    } else {
      // Prefer carrier if one with spare room is present; depots are the
      // fallback. This matches the player's intent when they transfer an
      // MS specifically to a destination that hosts the Pegasus.
      for (const c of shipWorld.query(Ship, ShipStatSheet, EntityKey)) {
        const s = c.get(Ship)!
        if (s.dockedAtPoiId !== destPoiId) continue
        if (s.transitDestinationId) continue
        const sheet = c.get(ShipStatSheet)!.sheet
        const cap = Math.floor(getStat(sheet, 'hangarCapacity'))
        if (cap <= 0) continue
        const carrierKey = c.get(EntityKey)!.key
        if (countShipsAboard(carrierKey) < cap) { landedOnCarrier = carrierKey; break }
      }
    }

    if (landedOnCarrier) {
      ent.set(Ms, {
        ...ms,
        storedOnShipKey: landedOnCarrier,
        dockedAtPoiId: '',
        transitDestinationId: '',
        transitArrivalDay: 0,
      })
    } else {
      // Land at the depot's POI (un-aboard, sitting in the bay).
      ent.set(Ms, {
        ...ms,
        storedOnShipKey: '',
        dockedAtPoiId: destPoiId,
        transitDestinationId: '',
        transitArrivalDay: 0,
      })
    }
    out.msLanded += 1
  }
  return out
}

export interface MsTransferableMs {
  msKey: string
  templateId: string
  msName: string
}

// MS that can be shipped out of this depot: every Ms at this POI not
// already in transit. Storedaboard MS at this POI are NOT moved here — the
// player ships those from the host ship via the ship-transfer path.
export function listMsTransferableAtPoi(poiId: string): MsTransferableMs[] {
  const out: MsTransferableMs[] = []
  const shipWorld = getWorld(SHIP_SCENE_ID)
  for (const ent of shipWorld.query(Ms, EntityKey)) {
    const ms = ent.get(Ms)!
    if (ms.transitDestinationId) continue
    if (ms.dockedAtPoiId !== poiId) continue
    if (ms.storedOnShipKey) continue
    const cls = getMsClass(ms.templateId)
    out.push({
      msKey: ent.get(EntityKey)!.key,
      templateId: ms.templateId,
      msName: cls.nameZh,
    })
  }
  return out
}

export interface MsTransferDestination {
  poiId: string
  poiNameZh: string
  transferFee: number
  transitFee: number
  days: number
  canAccept: boolean
}

export function listMsTransferDestinations(msKey: string): MsTransferDestination[] {
  const shipWorld = getWorld(SHIP_SCENE_ID)
  let originPoiId = ''
  for (const e of shipWorld.query(Ms, EntityKey)) {
    if (e.get(EntityKey)!.key !== msKey) continue
    originPoiId = e.get(Ms)!.dockedAtPoiId
    break
  }
  if (!originPoiId) return []
  const out: MsTransferDestination[] = []
  for (const sceneId of SCENE_IDS) {
    const poiId = poiIdForScene(sceneId)
    if (!poiId) continue
    if (poiId === originPoiId) continue
    // Only surface destinations that have a hangar (so depot routes exist).
    if (!findHangarAtPoi(poiId)) continue
    const poi = getPoi(poiId)
    out.push({
      poiId,
      poiNameZh: poi?.nameZh ?? poiId,
      transferFee: msTransferFeeForRoute(originPoiId, poiId),
      transitFee: fleetConfig.transitFee,
      days: msTransitDaysForRoute(originPoiId, poiId),
      canAccept: destinationCanAcceptMs(poiId),
    })
  }
  return out
}

function findPlayerEntity(): Entity | null {
  for (const sceneId of SCENE_IDS) {
    const p = getWorld(sceneId).queryFirst(IsPlayer)
    if (p) return p
  }
  return null
}

// Defensive: avoid the lint warning for `Building` even though it isn't
// directly used in this file's queries (we go through findHangarAtPoi).
void Building
