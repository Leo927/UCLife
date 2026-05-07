// Player + world primitives: the active-scene world proxy itself, plus
// movement / introspection helpers used by the smoke suite
// (movePlayerTo, setMoveTarget, playerSnapshot, countByKind).

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { world } from '../../ecs/world'
import { IsPlayer, Position, MoveTarget, Money, Road, Building, Wall, Path } from '../../ecs/traits'

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
  const money = player.get(Money)
  return {
    pos: { x: pos.x, y: pos.y },
    pathLen: path?.waypoints.length ?? 0,
    pathIdx: path?.index ?? null,
    money: money?.amount ?? 0,
  }
})
