// Phase 6.2.E2 — auto-launch + cross-POI transit consequence of the
// flagship leaving a POI.
//
// One entry point — `onFlagshipUndock(originPoiId, gameDay)` — wired
// from sim/navigation.ts at the same site that already clears the
// flagship's dock binding. The function partitions every non-flagship
// active-fleet ship by POI:
//
//   - same POI as the flagship: spawn a FleetEscort body in
//     spaceCampaign; clear the ship's `dockedAtPoiId`. The fleet-
//     formation system then snaps the body to flagshipPos + slot offset
//     each frame.
//   - different POI: enqueue a cross-POI transit (charge fee, stamp
//     transit fields). The escort joins the fleet at the destination
//     POI when its arrivalDay rolls over (fleetTransitSystem).
//
// `onFlagshipDock(destPoiId)` is the inverse: every FleetEscort body in
// spaceCampaign for a ship marked active-fleet snaps to the flagship's
// new docked POI. Bodies despawn from spaceCampaign; long-arc state on
// the Ship trait re-binds to `dockedAtPoiId = destPoiId`.

import {
  Ship, EntityKey, FleetEscort, Position, Velocity, Thrust, ShipBody,
  IsInActiveFleet, IsFlagshipMark,
} from '../ecs/traits'
import { getWorld } from '../ecs/world'
import { partitionActiveFleetEscorts, enqueueShipTransit } from './fleetTransit'
import { emitSim } from '../sim/events'
import { getPoi } from '../data/pois'
import { dialogueText } from '../data/dialogueText'
import { getShipClass } from '../data/ship-classes'
import {
  releaseShipsFromCarrier, findCarrierSlotForShip, assignShipToCarrierBay,
  hasFreePoiSlotForShip, routeCapturedHullsToDelivery,
} from './shipDelivery'
import { useClock, gameDayNumber } from '../sim/clock'

const SHIP_SCENE_ID = 'playerShipInterior' as const
const SPACE_SCENE_ID = 'spaceCampaign' as const

export interface FlagshipUndockResult {
  launchedSameSite: number
  queuedTransit: number
  transitFailures: number
}

// Drive the auto-launch + auto-transit consequences when the flagship
// leaves `originPoiId`. Idempotent: calling it twice for the same undock
// is a no-op the second time (no duplicate FleetEscort bodies; transit
// rejects already-in-transit ships).
export function onFlagshipUndock(originPoiId: string, gameDay: number): FlagshipUndockResult {
  const result: FlagshipUndockResult = {
    launchedSameSite: 0,
    queuedTransit: 0,
    transitFailures: 0,
  }
  if (!originPoiId) return result
  const partition = partitionActiveFleetEscorts(originPoiId)

  const space = getWorld(SPACE_SCENE_ID)
  const shipWorld = getWorld(SHIP_SCENE_ID)

  // Phase 6.2.5 — release any MS stored inside the flagship's internal bay
  // before it leaves port. Stored ships keep dockedAtPoiId = originPoiId
  // and become overflow there.
  const flagshipEnt = shipWorld.queryFirst(IsFlagshipMark)
  if (flagshipEnt) {
    const flagshipKey = flagshipEnt.get(EntityKey)?.key ?? ''
    if (flagshipKey) releaseShipsFromCarrier(flagshipKey)
  }

  for (const escortEnt of partition.sameAsFlagshipPoi) {
    const s = escortEnt.get(Ship)!
    const shipKey = escortEnt.get(EntityKey)?.key ?? ''
    if (!shipKey) continue
    // Phase 6.2.5 — release MS stored inside this escort carrier before launch.
    releaseShipsFromCarrier(shipKey)
    // Clear dock binding — the escort is now in flight.
    escortEnt.set(Ship, { ...s, dockedAtPoiId: '' })
    // Spawn (or reuse) a FleetEscort body in spaceCampaign. The
    // formation system positions it each frame; Velocity / Thrust /
    // ShipBody mirror the flagship body shape so the existing space
    // sim integrator doesn't choke on missing traits.
    const existing = findEscortBody(shipKey)
    if (existing) continue
    space.spawn(
      FleetEscort({ shipKey }),
      ShipBody,
      Position({ x: 0, y: 0 }),
      Velocity({ vx: 0, vy: 0 }),
      Thrust({ ax: 0, ay: 0 }),
      EntityKey({ key: `escort-${shipKey}` }),
    )
    result.launchedSameSite++
  }

  for (const escortEnt of partition.differentPoi) {
    const s = escortEnt.get(Ship)!
    const fromPoi = s.dockedAtPoiId
    const r = enqueueShipTransit(escortEnt, fromPoi, originPoiId, gameDay)
    if (r.ok) {
      result.queuedTransit++
      const fromName = getPoi(fromPoi)?.nameZh ?? fromPoi
      const toName = getPoi(originPoiId)?.nameZh ?? originPoiId
      const tmpl = dialogueText.branches.warRoom.transitToastQueued
      emitSim('toast', {
        textZh: tmpl.replace('{from}', fromName).replace('{to}', toName).replace('{days}', String(r.days)),
      })
    } else {
      result.transitFailures++
    }
  }
  return result
}

export interface FlagshipDockResult {
  bodiesDespawned: number
  shipsDocked: number
}

// Inverse of onFlagshipUndock. When the flagship parks at a POI, every
// FleetEscort body in spaceCampaign despawns and its long-arc Ship
// re-docks at the new POI. Active-fleet ships in mid-transit are
// untouched — they keep moving toward their destination.
export function onFlagshipDock(destPoiId: string): FlagshipDockResult {
  const result: FlagshipDockResult = { bodiesDespawned: 0, shipsDocked: 0 }
  if (!destPoiId) return result
  const space = getWorld(SPACE_SCENE_ID)
  const shipWorld = getWorld(SHIP_SCENE_ID)
  const byKey = new Map<string, ReturnType<typeof shipWorld.queryFirst>>()
  for (const e of shipWorld.query(Ship, EntityKey, IsInActiveFleet)) {
    if (e.has(IsFlagshipMark)) continue
    byKey.set(e.get(EntityKey)!.key, e)
  }
  for (const e of [...space.query(FleetEscort)]) {
    const shipKey = e.get(FleetEscort)!.shipKey
    const shipEnt = byKey.get(shipKey)
    if (shipEnt) {
      const s = shipEnt.get(Ship)!
      shipEnt.set(Ship, { ...s, dockedAtPoiId: destPoiId })
      // Phase 6.2.5 — cascade: if no POI slot is free for this escort, try
      // an internal carrier bay. Only ms-class and smaller ships can board.
      const cls = getShipClass(s.templateId)
      if (!hasFreePoiSlotForShip(cls.hangarSlotClass, destPoiId)) {
        const carrier = findCarrierSlotForShip(cls.hangarSlotClass, destPoiId, shipKey)
        if (carrier) assignShipToCarrierBay(shipEnt, carrier)
      }
      result.shipsDocked++
    }
    e.destroy()
    result.bodiesDespawned++
  }
  // Issue #71 — route any captured in-flight hull (WasCaptured + no home
  // hangar) to a delivery queue at the docked POI, exactly like a fresh
  // purchase. Reuses the shipDelivery pipeline.
  routeCapturedHullsToDelivery(destPoiId, gameDayNumber(useClock.getState().gameDate))
  return result
}

// Public for use by the formation system and debug handles.
function findEscortBody(shipKey: string) {
  const space = getWorld(SPACE_SCENE_ID)
  for (const e of space.query(FleetEscort)) {
    if (e.get(FleetEscort)!.shipKey === shipKey) return e
  }
  return null
}
