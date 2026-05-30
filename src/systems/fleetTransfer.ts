// Phase 6.2.G — paid-and-delayed transfer-to-other-hangar verb. Surface
// for the hangar manager dialog. Wraps `enqueueShipTransit` with the
// extra player-driven gates the auto-launch path skips: destination
// capacity, mothball / flagship / transit refusal, dedicated transfer
// fee distinct from the active-fleet transitFee.
//
// Why a separate fee row: auto-launch transit is the *automatic*
// consequence of the player undocking the flagship — the player did
// not opt into the cost the moment they pressed undock. Transfer is
// the player explicitly clicking "ship X from A to B" at the manager
// dialog, so the fee can be heavier (and is authored per-route in
// fleet.json5) without surprising them.

import type { Entity } from 'koota'
import {
  Ship, EntityKey, IsFlagshipMark, Building, Hangar, IsPlayer, Money,
  type HangarSlotClass,
} from '../ecs/traits'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { fleetConfig } from '../config'
import { getShipClass } from '../data/ship-classes'
import { getPoi, poiIdForHangar } from '../data/pois'
import { fittingSlotClasses } from '../data/facilityTypes'
import { deriveHangarOccupancy } from './shipDelivery'
import { findHangarAtPoi } from './hangarQuery'
import {
  enqueueShipTransit, transitDaysForRoute, type EnqueueTransitFailReason,
} from './fleetTransit'

export type TransferFailReason =
  | 'ship_not_found'
  | 'flagship_locked'
  | 'mothballed'
  | 'in_transit'
  | 'not_docked'
  | 'same_poi'
  | 'dest_unknown'
  | 'dest_no_slot'
  | 'no_player'
  | 'no_funds'
  | EnqueueTransitFailReason

export type TransferResult =
  | {
      ok: true
      shipKey: string
      originPoiId: string
      destPoiId: string
      transferFee: number
      transitFee: number
      totalCost: number
      arrivalDay: number
      days: number
    }
  | { ok: false; reason: TransferFailReason }

// Per-route transfer fee resolved from `fleetConfig.transferFees`; the
// directed route key is `${origin}->${dest}`. A symmetric author would
// list both directions explicitly so VB→drydock can diverge from
// drydock→VB if a future tuning calls for it. Missing pair falls back
// to `transferFeeDefault`.
export function transferFeeForRoute(originPoiId: string, destPoiId: string): number {
  const key = `${originPoiId}->${destPoiId}`
  const explicit = fleetConfig.transferFees?.[key]
  if (typeof explicit === 'number') return explicit
  return fleetConfig.transferFeeDefault
}

export function enqueueHangarTransfer(
  shipEnt: Entity,
  destPoiId: string,
  gameDay: number,
): TransferResult {
  const s = shipEnt.get(Ship)
  if (!s) return { ok: false, reason: 'ship_not_found' }
  if (shipEnt.has(IsFlagshipMark)) return { ok: false, reason: 'flagship_locked' }
  if (s.mothballed) return { ok: false, reason: 'mothballed' }
  if (s.transitDestinationId) return { ok: false, reason: 'in_transit' }
  const originPoiId = s.dockedAtPoiId
  if (!originPoiId) return { ok: false, reason: 'not_docked' }
  if (originPoiId === destPoiId) return { ok: false, reason: 'same_poi' }
  if (!getPoi(destPoiId)) return { ok: false, reason: 'dest_unknown' }

  const cls = getShipClass(s.templateId)
  const destHangar = findHangarAtPoi(destPoiId)
  if (!destHangar) return { ok: false, reason: 'dest_unknown' }
  const h = destHangar.get(Hangar)!
  // Slot hierarchy: any slot class same-size-or-larger than the ship's
  // class can host it (capital ⊇ ms ⊇ smallCraft). Wasteful when the slot
  // is larger, but supported — overflow stays unbound at the POI.
  const fit = findFittingSlotForShip(h.slotCapacity, cls.hangarSlotClass, destPoiId)
  if (!fit) return { ok: false, reason: 'dest_no_slot' }

  // Composite cost: transferFee (route-specific, this slice's surface) +
  // transitFee (the existing per-trip charge that the auto-launch path
  // also pays). Pay both up front so refunding on a future cancel is a
  // single Money write.
  const transferFee = transferFeeForRoute(originPoiId, destPoiId)
  const transitFee = fleetConfig.transitFee
  const totalCost = transferFee + transitFee

  const player = findPlayerEntity()
  if (!player) return { ok: false, reason: 'no_player' }
  const m = player.get(Money) ?? { amount: 0 }
  if (m.amount < totalCost) return { ok: false, reason: 'no_funds' }

  // Debit only the transferFee here. enqueueShipTransit charges the
  // transitFee itself; pre-checked totalCost above so the Money state
  // is consistent across both writes.
  if (transferFee > 0) {
    player.set(Money, { amount: m.amount - transferFee })
  }

  const enq = enqueueShipTransit(shipEnt, originPoiId, destPoiId, gameDay)
  if (!enq.ok) {
    // Roll back the transferFee debit since the transit didn't take.
    if (transferFee > 0) {
      const m2 = player.get(Money) ?? { amount: 0 }
      player.set(Money, { amount: m2.amount + transferFee })
    }
    return { ok: false, reason: enq.reason }
  }

  return {
    ok: true,
    shipKey: enq.shipKey,
    originPoiId,
    destPoiId,
    transferFee,
    transitFee,
    totalCost,
    arrivalDay: enq.arrivalDay,
    days: enq.days,
  }
}

// Available destinations for a docked ship: every hangar at a POI other
// than the ship's current POI whose slot class matches the ship class.
// Used by the hangar manager dialog to populate the destination picker
// + by the smoke to assert capacity gating.
export interface TransferDestination {
  poiId: string
  poiNameZh: string
  hangarBuildingKey: string
  hangarLabel: string
  slotClass: HangarSlotClass
  slotCapacity: number
  slotOccupancy: number
  hasOpenSlot: boolean
  transferFee: number
  transitFee: number
  days: number
}

export function listTransferDestinations(shipEnt: Entity): TransferDestination[] {
  const s = shipEnt.get(Ship)
  if (!s) return []
  const cls = getShipClass(s.templateId)
  const originPoiId = s.dockedAtPoiId
  const out: TransferDestination[] = []
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const b of w.query(Building, Hangar, EntityKey)) {
      const poiId = poiIdForHangar(sceneId, b.get(Building)!)
      if (!poiId) continue
      if (poiId === originPoiId) continue
      const h = b.get(Hangar)!
      // Surface every hangar that *could* host this ship class (per the
      // hierarchy), free or full. A full hangar is reported with
      // hasOpenSlot=false so the manager UI can render it grayed out
      // instead of letting it silently vanish from the picker.
      const fittingClasses = fittingSlotClasses(h.slotCapacity, cls.hangarSlotClass)
      if (fittingClasses.length === 0) continue
      // Share the occupancy snapshot with findFittingSlotForShip's
      // internal call — same poiId, same tick, so re-deriving for the
      // fallback report below would just be a wasted scan.
      const occMap = deriveHangarOccupancy(poiId)
      const fit = pickFittingSlot(h.slotCapacity, cls.hangarSlotClass, occMap)
      const reportClass = fit?.slotClass ?? fittingClasses[fittingClasses.length - 1]
      const reportCap = fit?.cap ?? (h.slotCapacity[reportClass] ?? 0)
      const reportOcc = fit?.occ ?? (occMap[reportClass] ?? 0)
      const poi = getPoi(poiId)
      out.push({
        poiId,
        poiNameZh: poi?.nameZh ?? poiId,
        hangarBuildingKey: b.get(EntityKey)!.key,
        hangarLabel: b.get(Building)?.label ?? '',
        slotClass: reportClass,
        slotCapacity: reportCap,
        slotOccupancy: reportOcc,
        hasOpenSlot: !!fit,
        transferFee: transferFeeForRoute(originPoiId, poiId),
        transitFee: fleetConfig.transitFee,
        days: transitDaysForRoute(originPoiId, poiId),
      })
    }
  }
  return out
}

// Ships that this hangar (at `poiId`) can ship out: every docked-here,
// non-flagship, non-mothballed, non-in-transit ship. Surface for the
// manager dialog's ship picker.
export interface TransferableShip {
  shipKey: string
  templateId: string
  shipName: string
  slotClass: HangarSlotClass
}

export function listTransferableShipsAtPoi(poiId: string): TransferableShip[] {
  const out: TransferableShip[] = []
  const shipWorld = getWorld('playerShipInterior')
  for (const ent of shipWorld.query(Ship, EntityKey)) {
    const s = ent.get(Ship)!
    if (ent.has(IsFlagshipMark)) continue
    if (s.mothballed) continue
    if (s.transitDestinationId) continue
    if (s.dockedAtPoiId !== poiId) continue
    const cls = getShipClass(s.templateId)
    out.push({
      shipKey: ent.get(EntityKey)!.key,
      templateId: s.templateId,
      shipName: cls.nameZh,
      slotClass: cls.hangarSlotClass,
    })
  }
  return out
}

// Smallest slot class in this hangar that still has free capacity and can
// accept `shipClass` (per the hierarchy). Returns null when nothing fits.
// Snuggest-fit preference avoids burning a capital slot on an MS when an
// MS slot is available.
function findFittingSlotForShip(
  slotCapacity: Partial<Record<HangarSlotClass, number>>,
  shipClass: HangarSlotClass,
  poiId: string,
): { slotClass: HangarSlotClass; cap: number; occ: number } | null {
  return pickFittingSlot(slotCapacity, shipClass, deriveHangarOccupancy(poiId))
}

// Pure variant of findFittingSlotForShip that takes the occupancy map as
// a parameter. Callers that already derived the map for this POI use this
// to avoid a redundant greedy walk.
function pickFittingSlot(
  slotCapacity: Partial<Record<HangarSlotClass, number>>,
  shipClass: HangarSlotClass,
  occMap: Record<string, number>,
): { slotClass: HangarSlotClass; cap: number; occ: number } | null {
  // fittingSlotClasses returns largest-first; reverse to try snuggest first.
  const fitting = fittingSlotClasses(slotCapacity, shipClass).slice().reverse()
  for (const cls of fitting) {
    const cap = slotCapacity[cls] ?? 0
    const occ = occMap[cls] ?? 0
    if (occ < cap) return { slotClass: cls, cap, occ }
  }
  return null
}

function findPlayerEntity(): Entity | null {
  for (const sceneId of SCENE_IDS) {
    const p = getWorld(sceneId).queryFirst(IsPlayer)
    if (p) return p
  }
  return null
}
