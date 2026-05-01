import type { Entity, World } from 'koota'
import { BarSeat, Position, Action, Knows } from '../ecs/traits'
import { tierOf } from './relations'

export function getClaimedBarSeatFor(world: World, entity: Entity): Entity | null {
  for (const seat of world.query(BarSeat)) {
    const s = seat.get(BarSeat)!
    if (s.occupant === entity) return seat
  }
  return null
}

// When `requester` is supplied, free seats are scored by adjacency to
// current occupants: friends pull toward, rivals/enemies push away.
const ADJACENCY_RADIUS_PX = 48

const SEAT_SCORE: Record<ReturnType<typeof tierOf>, number> = {
  friend: 10,
  acquaintance: 1,
  stranger: 0,
  rival: -5,
  enemy: -10,
}

export function findFreeBarSeat(world: World, requester?: Entity): Entity | null {
  const allSeats: { seat: Entity; pos: { x: number; y: number }; occupant: Entity | null }[] = []
  for (const seat of world.query(BarSeat, Position)) {
    const s = seat.get(BarSeat)!
    const p = seat.get(Position)!
    allSeats.push({ seat, pos: { x: p.x, y: p.y }, occupant: s.occupant })
  }
  if (allSeats.length === 0) return null

  if (!requester) {
    return allSeats.find((s) => s.occupant === null)?.seat ?? null
  }

  let best: Entity | null = null
  let bestScore = -Infinity
  for (const candidate of allSeats) {
    if (candidate.occupant !== null) continue
    let score = 0
    for (const other of allSeats) {
      if (other === candidate) continue
      if (!other.occupant) continue
      const dist = Math.hypot(candidate.pos.x - other.pos.x, candidate.pos.y - other.pos.y)
      if (dist > ADJACENCY_RADIUS_PX) continue
      // No Knows edge → stranger.
      let tier: ReturnType<typeof tierOf> = 'stranger'
      if (requester.has(Knows(other.occupant))) {
        const e = requester.get(Knows(other.occupant))!
        tier = tierOf(e.opinion, e.familiarity)
      }
      score += SEAT_SCORE[tier]
    }
    if (score > bestScore) {
      bestScore = score
      best = candidate.seat
    }
  }
  return best
}

// Returns false on race (seat taken between find and claim).
export function claimBarSeat(_world: World, entity: Entity, seat: Entity): boolean {
  const s = seat.get(BarSeat)
  if (!s) return false
  if (s.occupant !== null && s.occupant !== entity) return false
  seat.set(BarSeat, { occupant: entity })
  return true
}

export function releaseBarSeatFor(world: World, entity: Entity): void {
  for (const seat of world.query(BarSeat)) {
    const s = seat.get(BarSeat)!
    if (s.occupant === entity) {
      seat.set(BarSeat, { occupant: null })
    }
  }
}

export function getClaimedBarSeatPos(world: World, entity: Entity): { x: number; y: number } | null {
  const seat = getClaimedBarSeatFor(world, entity)
  if (!seat) return null
  return seat.get(Position) ?? null
}

// Stale if the occupant is far from the seat AND not currently walking
// or reveling. Walking is exempt to avoid flapping during travel.
const STALE_DIST_PX = 50

export function releaseStaleBarSeats(world: World): void {
  for (const seat of world.query(BarSeat, Position)) {
    const s = seat.get(BarSeat)!
    const occ = s.occupant
    if (!occ) continue
    const seatPos = seat.get(Position)!
    const occPos = occ.get(Position)
    const occAct = occ.get(Action)
    if (!occPos || !occAct) {
      seat.set(BarSeat, { occupant: null })
      continue
    }
    if (occAct.kind === 'reveling') continue
    if (occAct.kind === 'walking') continue
    const dist = Math.hypot(occPos.x - seatPos.x, occPos.y - seatPos.y)
    if (dist > STALE_DIST_PX) seat.set(BarSeat, { occupant: null })
  }
}
