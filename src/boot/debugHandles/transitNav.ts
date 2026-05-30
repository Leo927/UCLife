// NPC transit-navigation debug handles (Design/phasing.md § Step 1). Lets the
// smoke suite enumerate the active scene's transit portals and ask whether a
// given entity's foot-path to a destination would route through one — the
// asymmetry the fare gate depends on (NPCs may, the player may not).

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { world } from '../../ecs/world'
import { EntityKey, IsPlayer, Position, MoveTarget } from '../../ecs/traits'
import { findPath } from '../../systems/pathfinding'
import { getTransitPortals } from '../../systems/transitNav'
import { movementSystem } from '../../systems/movement'
import { worldConfig } from '../../config'

const TILE = worldConfig.tilePx

function entityByKey(key: string): ReturnType<typeof world.queryFirst> {
  for (const e of world.query(EntityKey)) {
    if (e.get(EntityKey)!.key === key) return e
  }
  return undefined
}

function pxToTile(px: number, py: number): { x: number; y: number } {
  return { x: Math.round(px / TILE), y: Math.round(py / TILE) }
}

registerDebugHandle('transitPortals', () => {
  return getTransitPortals(world).map((p) => ({
    aTile: pxToTile(p.ax, p.ay),
    bTile: pxToTile(p.bx, p.by),
  }))
})

// Whether the named entity's foot-path to the given tile routes through a
// transit portal (a teleport waypoint). NPCs may; the player never does.
registerDebugHandle('pathUsesPortal', (entityKey: string, toTile: { x: number; y: number }): boolean | null => {
  const ent = entityByKey(entityKey)
  if (!ent) return null
  const pos = ent.get(Position)
  if (!pos) return null
  const wps = findPath(world, ent, pos, { x: toTile.x * TILE, y: toTile.y * TILE })
  return wps.some((w) => w.portal === true)
})

// Same query for the player, by IsPlayer rather than key.
registerDebugHandle('playerPathUsesPortal', (toTile: { x: number; y: number }): boolean | null => {
  const player = world.queryFirst(IsPlayer, Position)
  if (!player) return null
  const pos = player.get(Position)!
  const wps = findPath(world, player, pos, { x: toTile.x * TILE, y: toTile.y * TILE })
  return wps.some((w) => w.portal === true)
})

// Teleport a named entity to a tile — deterministic placement for tests that
// need an NPC standing at a specific kiosk before issuing a transit route.
registerDebugHandle('placeEntityAtTile', (entityKey: string, tile: { x: number; y: number }): boolean => {
  const ent = entityByKey(entityKey)
  if (!ent || !ent.has(Position)) return false
  ent.set(Position, { x: tile.x * TILE, y: tile.y * TILE })
  if (ent.has(MoveTarget)) ent.set(MoveTarget, { x: tile.x * TILE, y: tile.y * TILE })
  return true
})

// Issue a move target to a named entity (drives its foot-path next tick).
registerDebugHandle('driveEntityToTile', (entityKey: string, tile: { x: number; y: number }): boolean => {
  const ent = entityByKey(entityKey)
  if (!ent) return false
  const target = { x: tile.x * TILE, y: tile.y * TILE }
  if (ent.has(MoveTarget)) ent.set(MoveTarget, target)
  else ent.add(MoveTarget(target))
  return true
})

// Current tile of a named entity (rounded), for arrival assertions.
registerDebugHandle('entityTile', (entityKey: string): { x: number; y: number } | null => {
  const ent = entityByKey(entityKey)
  const pos = ent?.get(Position)
  if (!pos) return null
  return { x: Math.round(pos.x / TILE), y: Math.round(pos.y / TILE) }
})

// Drive an NPC to a tile through the movement system in isolation (no BT
// override), then report its resulting tile. Proves the diegetic transit
// execution — walk to kiosk A, traverse the portal, continue from kiosk B —
// deterministically, without the survival/wander BT stomping the target. The
// step count and per-step game-minutes are caller-supplied so the test owns
// the time budget; movement is the only system run.
registerDebugHandle('walkEntityViaMovement', (
  entityKey: string,
  toTile: { x: number; y: number },
  steps: number,
  gameMinutesPerStep: number,
): { x: number; y: number } | null => {
  const ent = entityByKey(entityKey)
  if (!ent) return null
  const target = { x: toTile.x * TILE, y: toTile.y * TILE }
  if (ent.has(MoveTarget)) ent.set(MoveTarget, target)
  else ent.add(MoveTarget(target))
  for (let i = 0; i < steps; i++) movementSystem(world, gameMinutesPerStep)
  const pos = ent.get(Position)
  if (!pos) return null
  return { x: Math.round(pos.x / TILE), y: Math.round(pos.y / TILE) }
})
