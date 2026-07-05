// Cross-scene player migration is destroy-and-respawn because koota entity
// ids are stamped with the world id, so an Entity from scene A can't be
// inserted into scene B's world. Job/Home/PendingEviction/Workstation refs
// point at origin-scene entities and are intentionally dropped.

import { create } from 'zustand'
import {
  getWorld, setActiveSceneId, getActiveSceneId, type SceneId,
} from '../ecs/world'
import {
  IsPlayer, Position, MoveTarget, Action, Bed, Workstation,
  Ship, EntityKey, Owner, IsFlagshipMark, IsInActiveFleet,
} from '../ecs/traits'
import { recomputeFleetPool } from '../ecs/fleetPool'
import { migratePlayerEntity } from '../character/migrate'
import { markPathfindingDirty, warmPathfinding } from '../systems/pathfinding'
import { getSceneConfig, type ShipSceneConfig } from '../data/scenes'
import { getShipClass, type ShipClassDef } from '../data/ship-classes'
import { seedShipSceneLayout, tearDownShipSceneLayout, refreshMsLayout } from '../ecs/spawn'
import { worldConfig, fleetConfig } from '../config'
import { emitSim } from './events'

interface SceneState {
  activeId: SceneId
  // Bumped on every swap so React can re-mount with the new scene's koota
  // World even though the proxy export's identity never changes.
  swapNonce: number
  setActive: (id: SceneId) => void
}

export const useScene = create<SceneState>((set) => ({
  activeId: getActiveSceneId(),
  swapNonce: 0,
  setActive: (id) => {
    setActiveSceneId(id)
    markPathfindingDirty()
    warmPathfinding(getWorld(id))
    set((s) => ({ activeId: id, swapNonce: s.swapNonce + 1 }))
  },
}))

// Same-scene call is a plain teleport — no destroy/respawn.
export function migratePlayerToScene(
  toSceneId: SceneId,
  arrivalTilePx: { x: number; y: number },
): void {
  const fromSceneId = getActiveSceneId()
  if (fromSceneId === toSceneId) {
    const w = getWorld(toSceneId)
    const p = w.queryFirst(IsPlayer)
    if (!p) return
    p.set(Position, { x: arrivalTilePx.x, y: arrivalTilePx.y })
    p.set(MoveTarget, { x: arrivalTilePx.x, y: arrivalTilePx.y })
    p.set(Action, { kind: 'idle', remaining: 0, total: 0 })
    return
  }

  const fromWorld = getWorld(fromSceneId)
  const toWorld = getWorld(toSceneId)
  const oldPlayer = fromWorld.queryFirst(IsPlayer)
  if (!oldPlayer) {
    throw new Error(`migratePlayerToScene: no player in ${fromSceneId}`)
  }

  // Free back-references the source scene held to this player entity —
  // without this, the bed/workstation would carry a dangling occupant ref
  // pointing at a destroyed entity. Home/Job are forward-references on the
  // player, not back-references, so no scan needed for those.
  for (const bedEnt of fromWorld.query(Bed)) {
    const b = bedEnt.get(Bed)!
    if (b.occupant === oldPlayer) {
      bedEnt.set(Bed, { ...b, occupant: null })
    }
  }
  for (const wsEnt of fromWorld.query(Workstation)) {
    const w = wsEnt.get(Workstation)!
    if (w.occupant === oldPlayer) {
      wsEnt.set(Workstation, { ...w, occupant: null })
    }
  }

  migratePlayerEntity(oldPlayer, toWorld, arrivalTilePx)
  useScene.getState().setActive(toSceneId)
}

const SHIP_SCENE_ID: SceneId = 'playerShipInterior'

// Walks the player into the ship's bridge (or whichever room the scene
// declares as playerSpawnRoomId). The ship world's Ship/ShipRoom/etc.
// entities persist across boardings — they live as long as the koota world
// does, which is for the program's lifetime.
export function boardShip(): void {
  if (getActiveSceneId() === SHIP_SCENE_ID) return

  const cfg = getSceneConfig(SHIP_SCENE_ID) as ShipSceneConfig
  const cls = getShipClass(cfg.shipClassId)
  const room = cls.rooms.find((r) => r.id === cfg.playerSpawnRoomId)
  if (!room) {
    throw new Error(
      `boardShip: ship class "${cls.id}" has no room "${cfg.playerSpawnRoomId}"`,
    )
  }
  const px = (room.bounds.x + room.bounds.w / 2) * worldConfig.tilePx
  const py = (room.bounds.y + room.bounds.h / 2) * worldConfig.tilePx
  migratePlayerToScene(SHIP_SCENE_ID, { x: px, y: py })
}

export function disembarkShip(
  toSceneId: SceneId,
  arrivalTilePx: { x: number; y: number },
): void {
  const fromSceneId = getActiveSceneId()
  if (fromSceneId !== SHIP_SCENE_ID) {
    throw new Error(`disembarkShip from non-ship scene: ${fromSceneId}`)
  }
  migratePlayerToScene(toSceneId, arrivalTilePx)
}

// Board a specific docked ship by its EntityKey. If the target is already
// the flagship this is exactly `boardShip()`. Otherwise it performs the
// flagship-switch operation per Design/fleet.md:
//   1. Validate target is player-owned, not mothballed, not in transit.
//   2. Migrate `IsFlagshipMark` from the current flagship to the target.
//   3. Tear down the interior scene's class-specific layout and reseed
//      it from the target ship class's room / wall / kiosk authoring.
//   4. Land the player in the new class's spawn room.
//
// Multi-class interior switching is the Phase 6.3 slice — the layout
// rebuild is bounded by the same authored data the boot path uses, so
// the runtime path mirrors the bootstrap path 1:1.
export function boardShipByKey(targetShipKey: string): { ok: true } | { ok: false; reasonZh: string } {
  const shipWorld = getWorld(SHIP_SCENE_ID)
  let target: ReturnType<typeof shipWorld.queryFirst> | undefined
  for (const e of shipWorld.query(Ship, EntityKey)) {
    if (e.get(EntityKey)!.key === targetShipKey) { target = e; break }
  }
  if (!target) return { ok: false, reasonZh: '舰艇已不在此停泊' }

  const owner = target.get(Owner)
  if (!owner || owner.kind !== 'character') {
    return { ok: false, reasonZh: '这艘船不归你所有' }
  }

  const ship = target.get(Ship)
  if (!ship) return { ok: false, reasonZh: '舰艇已不在此停泊' }
  if (ship.mothballed) return { ok: false, reasonZh: '该舰已封存 · 解除封存后再登舰' }
  if (ship.transitDestinationId) return { ok: false, reasonZh: '该舰在转运中 · 抵达后再登舰' }

  if (target.has(IsFlagshipMark)) {
    boardShip()
    return { ok: true }
  }

  // Resolve target class up-front so a missing class fails before we
  // mutate the interior — the bootstrap reseed needs the class def too.
  const targetCls = getShipClass(ship.templateId)

  const currentFlagship = shipWorld.queryFirst(IsFlagshipMark)
  if (currentFlagship) {
    currentFlagship.remove(IsFlagshipMark)
    const cur = currentFlagship.get(Ship)
    if (cur) {
      // Old flagship drops out of the war-room flagship slot. It stays in
      // the fleet (IsInActiveFleet untouched) but reverts to reserve
      // formation until the player re-places it on the plot table.
      currentFlagship.set(Ship, { ...cur, formationSlot: -1 })
    }
  }
  target.add(IsFlagshipMark)
  const wasActiveAlready = target.has(IsInActiveFleet)
  if (!wasActiveAlready) target.add(IsInActiveFleet)
  target.set(Ship, { ...ship, formationSlot: fleetConfig.activeFleetGrid.flagshipSlot })
  // A reserve ship (no IsInActiveFleet) can be boarded directly — the target
  // isn't required to already be in the active fleet. Boarding it here just
  // promoted it, so the roster sumStat() draws from grew; recompute the
  // pool's capacity to match. No `topUp` — boarding is routine transit, not
  // a free refuel (see grantFirstHullOnboarding for the one place a top-up
  // is warranted: the dealer's delivered-fuelled first hull).
  if (!wasActiveAlready) recomputeFleetPool()

  tearDownShipSceneLayout(shipWorld)
  seedShipSceneLayout(targetCls, shipWorld)
  // W1 Task 5 — any MS stowed aboard the new flagship (e.g. the starter MS
  // granted with the player's first bought hull) renders in its hangar bay
  // only once that hull is the flagship. Re-place the MS sprites here.
  refreshMsLayout()

  const arrival = spawnPixelsForClass(targetCls)
  migratePlayerToScene(SHIP_SCENE_ID, arrival)
  emitSim('toast', { textZh: `已登舰 · ${ship.name}` })
  return { ok: true }
}

function spawnPixelsForClass(cls: ShipClassDef): { x: number; y: number } {
  const cfg = getSceneConfig(SHIP_SCENE_ID) as ShipSceneConfig
  const room =
    cls.rooms.find((r) => r.id === cfg.playerSpawnRoomId) ?? cls.rooms[0]
  if (!room) {
    throw new Error(`boardShipByKey: ship class "${cls.id}" has no rooms`)
  }
  const px = (room.bounds.x + room.bounds.w / 2) * worldConfig.tilePx
  const py = (room.bounds.y + room.bounds.h / 2) * worldConfig.tilePx
  return { x: px, y: py }
}
