// Cross-scene player migration is destroy-and-respawn because koota entity
// ids are stamped with the world id, so an Entity from scene A can't be
// inserted into scene B's world. Job/Home/PendingEviction/Workstation refs
// point at origin-scene entities and are intentionally dropped.

import { create } from 'zustand'
import {
  getWorld, setActiveSceneId, getActiveSceneId, type SceneId,
} from '../ecs/world'
import {
  IsPlayer, Position, MoveTarget, Action, Vitals, Health, Money, Skills,
  Inventory, Job, JobPerformance, Attributes, Reputation, JobTenure,
  Character, Appearance, Bed, Workstation, EntityKey, Home, PendingEviction,
  FactionRole,
} from '../ecs/traits'
import { markPathfindingDirty } from '../systems/pathfinding'
import { getSceneConfig, type ShipSceneConfig } from '../data/scenes'
import { getShipClass } from '../data/ships'
import { worldConfig } from '../config'

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

  const character = oldPlayer.get(Character)
  const vitals = oldPlayer.get(Vitals)
  const health = oldPlayer.get(Health)
  const money = oldPlayer.get(Money)
  const skills = oldPlayer.get(Skills)
  const inventory = oldPlayer.get(Inventory)
  const attributes = oldPlayer.get(Attributes)
  const reputation = oldPlayer.get(Reputation)
  const jobTenure = oldPlayer.get(JobTenure)
  const appearance = oldPlayer.get(Appearance)
  const factionRole = oldPlayer.get(FactionRole)

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

  oldPlayer.destroy()

  const px = arrivalTilePx.x
  const py = arrivalTilePx.y
  const newPlayer = toWorld.spawn(
    IsPlayer,
    character ? Character(character) : Character,
    Position({ x: px, y: py }),
    MoveTarget({ x: px, y: py }),
    vitals ? Vitals(vitals) : Vitals,
    health ? Health(health) : Health,
    Action({ kind: 'idle', remaining: 0, total: 0 }),
    money ? Money(money) : Money,
    skills ? Skills(skills) : Skills,
    inventory ? Inventory(inventory) : Inventory,
    Job,
    JobPerformance,
    attributes ? Attributes(attributes) : Attributes,
    reputation ? Reputation(reputation) : Reputation,
    jobTenure ? JobTenure(jobTenure) : JobTenure,
    EntityKey({ key: 'player' }),
  )
  if (appearance) newPlayer.add(Appearance(appearance))
  if (factionRole) newPlayer.add(FactionRole(factionRole))
  // Guard against accidentally carrying origin-scene refs across the
  // boundary if a respawn ever picks these up.
  if (newPlayer.has(Home)) newPlayer.remove(Home)
  if (newPlayer.has(PendingEviction)) newPlayer.remove(PendingEviction)

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
