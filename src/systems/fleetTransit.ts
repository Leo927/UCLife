// Phase 6.2.E2 — cross-POI ship transit + auto-launch on flagship undock.
//
// Two surfaces, one daily lander tick:
//
//   1. `enqueueShipTransit(shipEnt, originPoiId, destPoiId, gameDay)` —
//      flip a Ship's `transit*` fields, clear `dockedAtPoiId`, charge the
//      transit fee against the player. Used by:
//        - 6.2.E2: auto-launch consequence when a non-flagship active
//          ship sits at a POI different from the flagship's at undock.
//        - 6.2.G (forthcoming): hangar-manager `transfer-to-other-hangar`
//          verb. Same fields, same daily lander.
//   2. `fleetTransitSystem(gameDay)` — runs on `day:rollover:settled`.
//      For each ship currently in transit, land it at `transitDestinationId`
//      when `gameDay >= transitArrivalDay`. Capacity at the destination
//      is *not* a gate at 6.2.E2 — escorts auto-queueing a transit
//      because the flagship undocked do not get to refuse arrival on a
//      cap mismatch. The G slice's surface adds the capacity gate when
//      the player drives the verb manually.
//
// Capacity model decision (E2 vs G): at E2 we always land — the active
// fleet is auto-queued from a player intent (flagship undock) and the
// destination is the flagship's POI; a destination cap mismatch would
// strand the escort indefinitely. The 6.2.G transfer verb adds a
// capacity check at the *enqueue* site instead.
//
// Save round-trip: the Ship trait's transit fields are persisted by the
// ship save handler. The lander tick is pure read-of-state — no extra
// save block needed.

import type { Entity } from 'koota'
import {
  Ship, EntityKey, IsInActiveFleet, IsFlagshipMark, IsPlayer, Money,
} from '../ecs/traits'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { fleetConfig } from '../config'
import { emitSim } from '../sim/events'

const SHIP_SCENE_ID = 'playerShipInterior' as const

// Resolve transit days for a route. Falls back to the configured default
// when the directed pair isn't authored. Symmetric pairs are listed
// explicitly in fleet.json5; this lookup intentionally does not auto-
// symmetrize (so VB→Granada can ever diverge from Granada→VB if the
// design ever calls for it).
export function transitDaysForRoute(originPoiId: string, destPoiId: string): number {
  const key = `${originPoiId}->${destPoiId}`
  const explicit = fleetConfig.transitDays[key]
  if (typeof explicit === 'number') return explicit
  return fleetConfig.transitDaysDefault
}

export type EnqueueTransitFailReason =
  | 'no_origin'
  | 'no_dest'
  | 'same_poi'
  | 'already_in_transit'
  | 'no_player'
  | 'no_funds'

export type EnqueueTransitResult =
  | { ok: true; shipKey: string; arrivalDay: number; days: number; feePaid: number }
  | { ok: false; reason: EnqueueTransitFailReason }

// Move a ship from `originPoiId` → `destPoiId`. The ship's dock binding
// is cleared and the transit fields are stamped. Returns the arrival day
// so the caller can log / toast the ETA.
export function enqueueShipTransit(
  shipEnt: Entity,
  originPoiId: string,
  destPoiId: string,
  gameDay: number,
): EnqueueTransitResult {
  const s = shipEnt.get(Ship)
  if (!s) return { ok: false, reason: 'no_origin' }
  if (!originPoiId) return { ok: false, reason: 'no_origin' }
  if (!destPoiId) return { ok: false, reason: 'no_dest' }
  if (originPoiId === destPoiId) return { ok: false, reason: 'same_poi' }
  if (s.transitDestinationId) return { ok: false, reason: 'already_in_transit' }

  // Fee debit (transitFee may be 0). Read the player entity from any scene
  // world; the fleet save handler doesn't carry Money.
  const fee = fleetConfig.transitFee
  if (fee > 0) {
    const player = findPlayerEntity()
    if (!player) return { ok: false, reason: 'no_player' }
    const m = player.get(Money) ?? { amount: 0 }
    if (m.amount < fee) return { ok: false, reason: 'no_funds' }
    player.set(Money, { amount: m.amount - fee })
  }

  const days = transitDaysForRoute(originPoiId, destPoiId)
  const arrivalDay = gameDay + days
  shipEnt.set(Ship, {
    ...s,
    dockedAtPoiId: '',
    transitOriginPoiId: originPoiId,
    transitDestinationId: destPoiId,
    transitDepartureDay: gameDay,
    transitArrivalDay: arrivalDay,
  })
  const k = shipEnt.get(EntityKey)?.key ?? ''
  return { ok: true, shipKey: k, arrivalDay, days, feePaid: fee }
}

export interface FleetTransitTickResult {
  landed: number
  shipsStillInTransit: number
}

// Daily lander. Any ship whose `transitArrivalDay <= gameDay` snaps to
// its destination POI; transit fields clear.
export function fleetTransitSystem(gameDay: number): FleetTransitTickResult {
  const w = getWorld(SHIP_SCENE_ID)
  let landed = 0
  let stillInTransit = 0
  for (const e of w.query(Ship)) {
    const s = e.get(Ship)!
    if (!s.transitDestinationId) continue
    if (gameDay < s.transitArrivalDay) { stillInTransit++; continue }
    const destPoiId = s.transitDestinationId
    e.set(Ship, {
      ...s,
      dockedAtPoiId: destPoiId,
      transitOriginPoiId: '',
      transitDestinationId: '',
      transitDepartureDay: 0,
      transitArrivalDay: 0,
    })
    landed++
    emitSim('log', {
      textZh: `舰艇抵港 · ${e.get(EntityKey)?.key ?? '舰艇'} 已停泊于 ${destPoiId}`,
      atMs: Date.now(),
    })
  }
  return { landed, shipsStillInTransit: stillInTransit }
}

// Snapshot of every ship currently in cross-POI transit. Used by the
// roster panel + smoke. Ordered by arrival day ascending so the player
// sees the next-to-arrive at the top.
export interface InTransitRow {
  shipKey: string
  originPoiId: string
  destinationPoiId: string
  departureDay: number
  arrivalDay: number
}

export function listShipsInTransit(): InTransitRow[] {
  const w = getWorld(SHIP_SCENE_ID)
  const out: InTransitRow[] = []
  for (const e of w.query(Ship, EntityKey)) {
    const s = e.get(Ship)!
    if (!s.transitDestinationId) continue
    out.push({
      shipKey: e.get(EntityKey)!.key,
      originPoiId: s.transitOriginPoiId,
      destinationPoiId: s.transitDestinationId,
      departureDay: s.transitDepartureDay,
      arrivalDay: s.transitArrivalDay,
    })
  }
  out.sort((a, b) => a.arrivalDay - b.arrivalDay)
  return out
}

// Find the player entity across every scene world; transit fee pulls
// from this. Mirrors the helper in fleetTransit's combat sibling.
function findPlayerEntity(): Entity | null {
  for (const sceneId of SCENE_IDS) {
    const p = getWorld(sceneId).queryFirst(IsPlayer)
    if (p) return p
  }
  return null
}

// Convenience: return non-flagship active-fleet ships, partitioned by
// whether they're at the same POI as `flagshipPoiId`. Used by the
// auto-launch path at flagship undock. Ships in transit are filtered
// out — they can't undock or queue a new transit while already moving.
export interface ActiveFleetPartition {
  sameAsFlagshipPoi: Entity[]
  differentPoi: Entity[]
}

export function partitionActiveFleetEscorts(flagshipPoiId: string): ActiveFleetPartition {
  const w = getWorld(SHIP_SCENE_ID)
  const sameAsFlagshipPoi: Entity[] = []
  const differentPoi: Entity[] = []
  for (const e of w.query(Ship, IsInActiveFleet)) {
    if (e.has(IsFlagshipMark)) continue
    const s = e.get(Ship)!
    if (s.transitDestinationId) continue
    if (!s.dockedAtPoiId) continue
    if (s.dockedAtPoiId === flagshipPoiId) sameAsFlagshipPoi.push(e)
    else differentPoi.push(e)
  }
  return { sameAsFlagshipPoi, differentPoi }
}
