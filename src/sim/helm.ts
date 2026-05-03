// Helm transitions: takeHelm() launches the player ship from a docked POI
// (debits fuel, snaps fleetPos to the live derived POI position, clears the
// dock binding, marks AtHelm) and switches to the spaceCampaign scene.
// leaveHelm() removes AtHelm and switches back to the ship interior. The
// ship continues moving in space because spaceSimSystem ticks every frame
// regardless of which scene the camera is on (see loop.ts).

import { getShipState, spendFuel, clearDocked, setFleetPos } from './ship'
import { getPoi } from '../data/pois'
import { getBody } from '../data/celestialBodies'
import { getWorld } from '../ecs/world'
import { useScene } from './scene'
import {
  IsPlayer, AtHelm, Course, ShipBody,
} from '../ecs/traits'
import { CELESTIAL_BODIES } from '../data/celestialBodies'
import { derivedPos } from '../engine/space/orbits'
import type { ParentResolver, OrbitalParams } from '../engine/space/types'
import { useClock } from './clock'
import { spaceConfig } from '../config'
import { logEvent } from '../ui/EventLog'

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

function derivedPoiPos(poiId: string): { x: number; y: number } | null {
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

export function takeHelm(): { ok: boolean; message?: string } {
  const ship = getShipState()
  if (!ship) return { ok: false, message: '未检测到飞船' }

  const dockedPoiId = ship.dockedAtPoiId
  if (!dockedPoiId) return { ok: false, message: '飞船当前未停泊于任何坐标' }

  const poi = getPoi(dockedPoiId)
  if (!poi) return { ok: false, message: '停泊坐标无效' }

  const fuelCost = takeoffFuelCostFor(dockedPoiId)
  if (ship.fuelCurrent < fuelCost) {
    return { ok: false, message: `燃料不足 · 起航需 ${fuelCost}` }
  }

  const launchPos = derivedPoiPos(dockedPoiId)
  if (!launchPos) return { ok: false, message: '无法解算坐标' }

  if (fuelCost > 0) {
    if (!spendFuel(fuelCost)) return { ok: false, message: '燃料扣除失败' }
  }
  setFleetPos(launchPos)
  clearDocked()

  const space = getWorld('spaceCampaign')
  const player = space.queryFirst(IsPlayer, ShipBody)
  if (player) {
    player.set(Course, { tx: 0, ty: 0, destPoiId: null, active: false })
    if (!player.has(AtHelm)) player.add(AtHelm)
  }

  useScene.getState().setActive('spaceCampaign')
  logEvent(`起航 · 自 ${poi.nameZh}`)
  return { ok: true }
}

export function leaveHelm(): void {
  const space = getWorld('spaceCampaign')
  const player = space.queryFirst(IsPlayer, ShipBody)
  const wasAtHelm = !!(player && player.has(AtHelm))
  if (player && wasAtHelm) player.remove(AtHelm)
  useScene.getState().setActive('playerShipInterior')
  if (wasAtHelm) logEvent('离开操舵台')
}
