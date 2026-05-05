// Player + world primitives: the active-scene world proxy itself, plus
// movement / introspection helpers. Used by the bulk of smoke tests
// (movePlayerTo, playerSnapshot, countByKind) and by probe-locked-room
// (findLockedCellPath, setMoveTarget).

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { world } from '../../ecs/world'
import {
  IsPlayer, Position, MoveTarget, Road, Building, Wall, Door, Bed, Path,
} from '../../ecs/traits'
import { findPath } from '../../systems/pathfinding'

const TILE = 32

registerDebugHandle('world', world)

registerDebugHandle('movePlayerTo', (tx: number, ty: number) => {
  const px = tx * TILE, py = ty * TILE
  for (const e of world.query(IsPlayer, Position)) {
    e.set(Position, { x: px, y: py })
    e.set(MoveTarget, { x: px, y: py })
    return true
  }
  return false
})

registerDebugHandle('countByKind', () => {
  let buildings = 0, walls = 0, roads = 0
  for (const _b of world.query(Building)) buildings++
  for (const _w of world.query(Wall)) walls++
  for (const _r of world.query(Road)) roads++
  return { buildings, walls, roads }
})

registerDebugHandle('setMoveTarget', (target: { x: number; y: number }) => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return false
  player.set(MoveTarget, target)
  return true
})

registerDebugHandle('playerSnapshot', () => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return null
  const pos = player.get(Position)!
  const path = player.get(Path)
  return {
    pos: { x: pos.x, y: pos.y },
    pathLen: path?.waypoints.length ?? 0,
    pathIdx: path?.index ?? null,
  }
})

// Probes for the locked-room regression test. Picks the first cell door
// whose bed has no occupant — i.e., a door currently locked for the
// player — and returns geometry + the result of pathing into it.
registerDebugHandle('findLockedCellPath', () => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return null
  let chosenDoor: { x: number; y: number; w: number; h: number; orient: 'h' | 'v' } | null = null
  let bedPos: { x: number; y: number } | null = null
  for (const dEnt of world.query(Door, Position)) {
    const d = dEnt.get(Door)!
    if (!d.bedEntity) continue
    const bed = d.bedEntity.get(Bed)
    if (!bed) continue
    // "Locked for player" = anyone except the player holds the lease.
    if (bed.occupant === player) continue
    chosenDoor = { x: d.x, y: d.y, w: d.w, h: d.h, orient: d.orient }
    const bp = d.bedEntity.get(Position)
    if (bp) bedPos = { x: bp.x, y: bp.y }
    break
  }
  if (!chosenDoor || !bedPos) return null
  const corridorOff = 24
  const start = chosenDoor.orient === 'h'
    ? { x: chosenDoor.x + chosenDoor.w / 2, y: chosenDoor.y - corridorOff }
    : { x: chosenDoor.x - corridorOff, y: chosenDoor.y + chosenDoor.h / 2 }
  // Try the opposite-side start if the chosen one is inside walls (no
  // path segment from there). The bed gives an oracle for "interior".
  const sameSideAsBed = chosenDoor.orient === 'h'
    ? (start.y < chosenDoor.y) === (bedPos.y < chosenDoor.y)
    : (start.x < chosenDoor.x) === (bedPos.x < chosenDoor.x)
  if (sameSideAsBed) {
    if (chosenDoor.orient === 'h') start.y = chosenDoor.y + chosenDoor.h + corridorOff
    else start.x = chosenDoor.x + chosenDoor.w + corridorOff
  }
  player.set(Position, start)
  player.set(MoveTarget, start)
  const wps = findPath(world, player, start, bedPos)
  const interiorReached = wps.some((wp) =>
    chosenDoor!.orient === 'h'
      ? (bedPos!.y > chosenDoor!.y ? wp.y > chosenDoor!.y + chosenDoor!.h : wp.y < chosenDoor!.y)
      : (bedPos!.x > chosenDoor!.x ? wp.x > chosenDoor!.x + chosenDoor!.w : wp.x < chosenDoor!.x),
  )
  return { door: chosenDoor, bed: bedPos, start, target: bedPos, wps, interiorReached }
})
