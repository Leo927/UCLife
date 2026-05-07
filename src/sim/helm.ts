// Helm transitions: takeHelm() opens the spaceCampaign view (the bridge),
// adds AtHelm to the player ship, and — if the ship is currently docked —
// snaps the campaign-world Position to the live POI orbit so the camera
// doesn't open onto a t=0 stale location. No fuel cost, no validation;
// the helm key is a pure view toggle.
//
// Launching from a dock (debit takeoff fuel + clearDocked + 起航 log)
// happens in sim/navigation.ts the moment a course is committed.
//
// leaveHelm() removes AtHelm and switches back to the ship interior. The
// ship continues moving in space because spaceSimSystem ticks every frame
// regardless of which scene the camera is on (see loop.ts).

import { getShipState, setFleetPos } from './ship'
import { getPoi } from '../data/pois'
import { getBody } from '../data/celestialBodies'
import { getWorld } from '../ecs/world'
import { useScene } from './scene'
import {
  IsPlayer, AtHelm, ShipBody, Position,
} from '../ecs/traits'
import { CELESTIAL_BODIES } from '../data/celestialBodies'
import { derivedPos } from '../engine/space/orbits'
import type { ParentResolver, OrbitalParams } from '../engine/space/types'
import { useClock } from './clock'
import { spaceConfig } from '../config'
import { emitSim } from './events'

const MS_PER_DAY = 24 * 60 * 60 * 1000

const bodyById = new Map(CELESTIAL_BODIES.map((b) => [b.id, b]))

const resolveBody: ParentResolver = (id: string): OrbitalParams | undefined => {
  const b = bodyById.get(id)
  if (!b) return undefined
  return {
    parentId: b.parentId ?? null,
    pos: b.pos,
    orbitRadius: b.orbitRadius,
    orbitPeriodDays: b.orbitPeriodDays,
    orbitPhase: b.orbitPhase,
  }
}

// Returns the takeoff fuel cost for the POI (preferred) or its body fallback.
export function takeoffFuelCostFor(poiId: string): number {
  const poi = getPoi(poiId)
  if (poi && typeof poi.takeoffFuelCost === 'number') return poi.takeoffFuelCost
  if (poi) {
    const body = getBody(poi.bodyId)
    if (body && typeof body.takeoffFuelCost === 'number') return body.takeoffFuelCost
  }
  return 0
}

export function derivedPoiPos(poiId: string): { x: number; y: number } | null {
  const poi = getPoi(poiId)
  if (!poi) return null
  const gameMs = useClock.getState().gameDate.getTime()
  const tDays = (gameMs / MS_PER_DAY) * spaceConfig.orbitTimeScale
  const params: OrbitalParams = {
    parentId: poi.bodyId,
    orbitRadius: poi.orbitRadius,
    orbitPeriodDays: poi.orbitPeriodDays,
    orbitPhase: poi.orbitPhase,
  }
  return derivedPos(params, tDays, resolveBody)
}

export function takeHelm(): { ok: true } {
  const ship = getShipState()
  const space = getWorld('spaceCampaign')
  const player = space.queryFirst(IsPlayer, ShipBody)
  if (player && ship?.dockedAtPoiId) {
    const livePos = derivedPoiPos(ship.dockedAtPoiId)
    if (livePos) {
      player.set(Position, { x: livePos.x, y: livePos.y })
      setFleetPos(livePos)
    }
  }
  if (player && !player.has(AtHelm)) player.add(AtHelm)
  useScene.getState().setActive('spaceCampaign')
  return { ok: true }
}

export function leaveHelm(): void {
  const space = getWorld('spaceCampaign')
  const player = space.queryFirst(IsPlayer, ShipBody)
  const wasAtHelm = !!(player && player.has(AtHelm))
  if (player && wasAtHelm) player.remove(AtHelm)
  useScene.getState().setActive('playerShipInterior')
  if (wasAtHelm) {
    emitSim('log', { textZh: '离开操舵台', atMs: useClock.getState().gameDate.getTime() })
  }
}
