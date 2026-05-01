import type { World } from 'koota'
import { Position, MoveTarget, Action, Path, Character, Health, Active, IsPlayer } from '../ecs/traits'
import { findPath } from './pathfinding'
import { feedUse, statValue } from './attributes'
import { FEED, statMult } from '../data/stats'
import { worldConfig } from '../config'
import { useUI } from '../ui/uiStore'

const PX_PER_GAME_MIN = worldConfig.movePxPerGameMin
const ARRIVE_EPS = worldConfig.arriveEpsPx
const WAYPOINT_EPS = worldConfig.waypointEpsPx

// Matches the circle radius drawn in render/Game.tsx so collisions read visually.
const BODY_RADIUS_PX = 9
const MIN_GAP_PX = BODY_RADIUS_PX * 2

export function movementSystem(world: World, gameMinutes: number) {
  for (const entity of world.query(Position, MoveTarget, Action)) {
    const pos = entity.get(Position)!
    const target = entity.get(MoveTarget)!
    const action = entity.get(Action)!
    if (action.kind !== 'idle' && action.kind !== 'walking') continue
    const reflexMult = statMult(statValue(entity, 'reflex'))

    const dx0 = target.x - pos.x
    const dy0 = target.y - pos.y
    const distFinal = Math.hypot(dx0, dy0)
    if (distFinal < ARRIVE_EPS) {
      pos.x = target.x
      pos.y = target.y
      if (action.kind === 'walking') action.kind = 'idle'
      if (entity.has(Path)) entity.remove(Path)
      entity.set(Position, pos)
      entity.set(Action, action)
      continue
    }

    let path = entity.get(Path)
    if (!path || path.targetX !== target.x || path.targetY !== target.y) {
      const wps = findPath(world, entity, pos, target)
      const next = { waypoints: wps, index: 0, targetX: target.x, targetY: target.y }
      if (entity.has(Path)) entity.set(Path, next)
      else entity.add(Path(next))
      path = next
      // If the player can't path AND the only blocker is a faction gate,
      // surface a toast. Only fires on freshly-recomputed empty paths.
      if (wps.length === 0 && entity.has(IsPlayer)) {
        const wpsNoFaction = findPath(world, null, pos, target)
        if (wpsNoFaction.length > 0) {
          useUI.getState().showToast('需要亚纳海姆电子员工身份')
        }
      }
    }

    if (path.waypoints.length === 0) {
      action.kind = 'idle'
      entity.set(Action, action)
      continue
    }

    if (action.kind === 'idle') action.kind = 'walking'

    feedUse(entity, 'reflex', FEED.walk, gameMinutes)

    let stepBudget = PX_PER_GAME_MIN * gameMinutes * reflexMult
    while (stepBudget > 0) {
      const wp = path.index < path.waypoints.length
        ? path.waypoints[path.index]
        : path.waypoints[path.waypoints.length - 1]
      const dx = wp.x - pos.x
      const dy = wp.y - pos.y
      const d = Math.hypot(dx, dy)
      if (d < ARRIVE_EPS) {
        pos.x = wp.x
        pos.y = wp.y
        if (path.index < path.waypoints.length) {
          path.index++
          continue
        }
        action.kind = 'idle'
        entity.remove(Path)
        break
      }
      if (stepBudget >= d) {
        pos.x = wp.x
        pos.y = wp.y
        stepBudget -= d
        if (path.index < path.waypoints.length) {
          path.index++
          if (d < WAYPOINT_EPS) continue
          continue
        }
        action.kind = 'idle'
        entity.remove(Path)
        break
      }
      pos.x += (dx / d) * stepBudget
      pos.y += (dy / d) * stepBudget
      stepBudget = 0
    }

    entity.set(Position, pos)
    entity.set(Action, action)
    if (entity.has(Path)) entity.set(Path, path)
  }

  // Walkers are movable; other actions (sleeping/eating/working) are
  // anchored. Two-walker overlaps split evenly; walker-vs-anchored
  // displaces only the walker — keeps sleepers within SLEEPING_AT_BED_PX
  // so rentSystem doesn't evict mid-collision.
  // Only Active characters participate; off-camera overlap is invisible.
  // The headless harness marks every Character Active (canvas 0×0).
  type BodySlot = {
    entity: ReturnType<typeof world.queryFirst>
    pos: { x: number; y: number }
    movable: boolean
    dirty: boolean
    bucket: number
  }
  const bodies: BodySlot[] = []
  for (const e of world.query(Active, Character, Position, Action)) {
    const h = e.get(Health)
    if (h?.dead) continue
    const p = e.get(Position)!
    const a = e.get(Action)!
    bodies.push({
      entity: e,
      pos: { x: p.x, y: p.y },
      movable: a.kind === 'walking',
      dirty: false,
      bucket: 0,
    })
  }

  // Cell size = 32px (one tile), > MIN_GAP_PX=18, so any overlapping pair
  // lives in the same or an adjacent cell.
  const CELL = 32
  const buckets = new Map<number, BodySlot[]>()
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i]
    const cx = Math.floor(b.pos.x / CELL)
    const cy = Math.floor(b.pos.y / CELL)
    const key = ((cy + 0x8000) << 16) | ((cx + 0x8000) & 0xffff)
    b.bucket = key
    let bucket = buckets.get(key)
    if (!bucket) { bucket = []; buckets.set(key, bucket) }
    bucket.push(b)
  }

  const idx = new Map<BodySlot, number>()
  for (let i = 0; i < bodies.length; i++) idx.set(bodies[i], i)

  for (let i = 0; i < bodies.length; i++) {
    const A = bodies[i]
    const acx = Math.floor(A.pos.x / CELL)
    const acy = Math.floor(A.pos.y / CELL)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const key = ((acy + dy + 0x8000) << 16) | ((acx + dx + 0x8000) & 0xffff)
        const bucket = buckets.get(key)
        if (!bucket) continue
        for (let k = 0; k < bucket.length; k++) {
          const B = bucket[k]
          if (idx.get(B)! <= i) continue
          const ddx = B.pos.x - A.pos.x
          const ddy = B.pos.y - A.pos.y
          const dist = Math.hypot(ddx, ddy)
          if (dist >= MIN_GAP_PX) continue
          if (!A.movable && !B.movable) continue
          // Index-parity push direction when fully co-located keeps the
          // choice deterministic across ticks.
          const safeDist = dist > 0.01 ? dist : 0.01
          const nx = dist > 0.01 ? ddx / safeDist : ((i + k) & 1 ? 1 : -1)
          const ny = dist > 0.01 ? ddy / safeDist : 0
          const overlap = MIN_GAP_PX - dist
          if (A.movable && B.movable) {
            const half = overlap * 0.5
            A.pos.x -= nx * half
            A.pos.y -= ny * half
            B.pos.x += nx * half
            B.pos.y += ny * half
            A.dirty = true; B.dirty = true
          } else if (A.movable) {
            A.pos.x -= nx * overlap
            A.pos.y -= ny * overlap
            A.dirty = true
          } else {
            B.pos.x += nx * overlap
            B.pos.y += ny * overlap
            B.dirty = true
          }
        }
      }
    }
  }
  for (const b of bodies) {
    if (b.dirty) b.entity!.set(Position, b.pos)
  }
}

