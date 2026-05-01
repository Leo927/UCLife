// Bench spots are exclusive; tap and trash sources stay shared.

import type { Entity, World } from 'koota'
import { RoughSpot, Position, Action } from '../ecs/traits'

export function getClaimedRoughSpotFor(world: World, entity: Entity): Entity | null {
  for (const spot of world.query(RoughSpot)) {
    const s = spot.get(RoughSpot)!
    if (s.occupant === entity) return spot
  }
  return null
}

export function findNearestFreeRoughSpot(world: World, pos: { x: number; y: number }): Entity | null {
  let best: Entity | null = null
  let bestD = Infinity
  for (const spot of world.query(RoughSpot, Position)) {
    const s = spot.get(RoughSpot)!
    if (s.occupant !== null) continue
    const p = spot.get(Position)!
    const d = Math.hypot(p.x - pos.x, p.y - pos.y)
    if (d < bestD) { bestD = d; best = spot }
  }
  return best
}

// Returns false on race (spot taken between find and claim).
export function claimRoughSpot(_world: World, entity: Entity, spot: Entity): boolean {
  const s = spot.get(RoughSpot)
  if (!s) return false
  if (s.occupant !== null && s.occupant !== entity) return false
  spot.set(RoughSpot, { occupant: entity })
  return true
}

export function releaseRoughSpotFor(world: World, entity: Entity): void {
  for (const spot of world.query(RoughSpot)) {
    const s = spot.get(RoughSpot)!
    if (s.occupant === entity) {
      spot.set(RoughSpot, { occupant: null })
    }
  }
}

export function getClaimedRoughSpotPos(world: World, entity: Entity): { x: number; y: number } | null {
  const spot = getClaimedRoughSpotFor(world, entity)
  if (!spot) return null
  return spot.get(Position) ?? null
}

const STALE_DIST_PX = 50

export function releaseStaleRoughSpots(world: World): void {
  for (const spot of world.query(RoughSpot, Position)) {
    const s = spot.get(RoughSpot)!
    const occ = s.occupant
    if (!occ) continue
    const spotPos = spot.get(Position)!
    const occPos = occ.get(Position)
    const occAct = occ.get(Action)
    if (!occPos || !occAct) {
      spot.set(RoughSpot, { occupant: null })
      continue
    }
    if (occAct.kind === 'sleeping') continue
    if (occAct.kind === 'walking') continue
    const dist = Math.hypot(occPos.x - spotPos.x, occPos.y - spotPos.y)
    if (dist > STALE_DIST_PX) spot.set(RoughSpot, { occupant: null })
  }
}
