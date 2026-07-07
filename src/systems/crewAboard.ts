// W4.1 — crew live aboard the flagship. Hired crew (captain + crewIds on
// the Ship trait) are materialized as Character bodies inside the
// ship-interior world (`playerShipInterior`), keyed by their stable
// `npc-crew-<N>` EntityKey.
//
// The interior world is the interior of the *currently boarded* ship — the
// flagship. So the invariant this module owns is: the ship world holds
// exactly the flagship's roster as crew bodies. Reserve-ship crew are
// "away" and carry no body here; a former flagship's crew re-materialize
// only when the player boards that hull again. reconcileCrewAboard() aligns
// the world to the flagship roster from scratch each call — extras removed,
// missing spawned, a body hired elsewhere relocated in (never duplicated
// across worlds).
//
// The bodies then tick on the existing active-scene npcSystem bucket
// scheduler like any city NPC; Task 2 gates a crew-duty BT branch on the
// CrewStation marker this module attaches.
//
// Perf (CLAUDE.md budget): reconcile is O(flagship roster + ship-world crew
// bodies), event-driven at board / flagship-switch / hire / fire / load —
// never per tick. N ≤ crewMax (≤ 200 on Pegasus). No new per-tick scaling.

import type { Entity } from 'koota'
import { getWorld, type SceneId, SCENE_IDS } from '../ecs/world'
import {
  Ship, EntityKey, Character, EmployedAsCrew, RecruitedTo, CrewStation,
  IsFlagshipMark,
} from '../ecs/traits'
import { getShipClass } from '../data/ship-classes'
import { worldConfig } from '../config'
import { spawnNPC } from '../character/spawn'
import { migrateNpcEntity } from '../character/migrate'
import { findPlayerEntity } from './fleetPlayer'

const SHIP_SCENE_ID: SceneId = 'playerShipInterior'
const TILE = worldConfig.tilePx

type CrewRole = 'captain' | 'crew'

// The roster's EntityKeys — captain first (when assigned), then crew. Empty
// slots are filtered so the caller never spawns a body for an empty key.
export function crewKeysForShip(ship: Entity): string[] {
  const s = ship.get(Ship)
  if (!s) return []
  const out: string[] = []
  if (s.assignedCaptainId) out.push(s.assignedCaptainId)
  for (const k of s.crewIds) if (k) out.push(k)
  return out
}

// The flagship (if any) in the ship-interior world.
export function flagshipEntity(): Entity | null {
  const shipWorld = getWorld(SHIP_SCENE_ID)
  return shipWorld.queryFirst(Ship, IsFlagshipMark, EntityKey) ?? null
}

function roleForKey(ship: Entity, key: string): CrewRole {
  return ship.get(Ship)?.assignedCaptainId === key ? 'captain' : 'crew'
}

// Where a freshly-materialized crew body lands. Crew quarters if the class
// authors it, else the class's first room — a walkable interior tile so the
// pathfinding-driven BT has an anchor. Task 2 replaces this with duty
// stations; Task 1 only needs a valid spawn tile.
function crewSpawnPosForShip(ship: Entity): { x: number; y: number } {
  const s = ship.get(Ship)!
  const cls = getShipClass(s.templateId)
  const room = cls.rooms.find((r) => r.id === 'crewQ') ?? cls.rooms[0]
  const cx = (room.bounds.x + room.bounds.w / 2) * TILE
  const cy = (room.bounds.y + room.bounds.h / 2) * TILE
  return { x: cx, y: cy }
}

function findCrewBodyElsewhere(key: string): Entity | null {
  for (const sceneId of SCENE_IDS) {
    if (sceneId === SHIP_SCENE_ID) continue
    const w = getWorld(sceneId)
    for (const e of w.query(Character, EntityKey)) {
      if (e.get(EntityKey)!.key === key) return e
    }
  }
  return null
}

// The duty-station anchor (px, ship-interior world) for the crew member at
// this roster ordinal, resolved from the flagship class's authored
// crewStations (wrapping when there are more crew than stations). Returns
// { -1, -1 } when the class authors no stations (crew idle at quarters).
function stationAnchorForOrdinal(ship: Entity, ordinal: number): { x: number; y: number; roomId: string } {
  const cls = getShipClass(ship.get(Ship)!.templateId)
  const stations = cls.crewStations
  if (!stations || stations.length === 0) return { x: -1, y: -1, roomId: '' }
  const st = stations[ordinal % stations.length]
  const room = cls.rooms.find((r) => r.id === st.roomId)
  if (!room) return { x: -1, y: -1, roomId: '' }
  const cx = (room.bounds.x + room.bounds.w / 2 + (st.offset?.dx ?? 0)) * TILE
  const cy = (room.bounds.y + room.bounds.h / 2 + (st.offset?.dy ?? 0)) * TILE
  return { x: cx, y: cy, roomId: st.roomId }
}

function ensureCrewMarkers(
  body: Entity, shipKey: string, role: CrewRole, anchor: { x: number; y: number; roomId: string },
): void {
  if (body.has(EmployedAsCrew)) body.set(EmployedAsCrew, { shipKey, role })
  else body.add(EmployedAsCrew({ shipKey, role }))
  const player = findPlayerEntity()
  if (player) {
    if (body.has(RecruitedTo)) body.set(RecruitedTo, { owner: player })
    else body.add(RecruitedTo({ owner: player }))
  }
  // Preserve the live duty decision across a re-reconcile (hire/fire of a
  // sibling shouldn't reset a crew member mid-watch); default to off-duty.
  const current = body.get(CrewStation)?.current ?? 'offDuty'
  const station = {
    roomEntity: null, roomId: anchor.roomId,
    anchorX: anchor.x, anchorY: anchor.y, current,
  }
  if (body.has(CrewStation)) body.set(CrewStation, station)
  else body.add(CrewStation(station))
}

// Hangar-boss role lookups live in ecs/crewRoles.ts (so the sim layer can
// read them without an upward import); re-exported here for existing
// systems-layer callers.
export {
  HANGAR_BOSS_ROOM_ID, isHangarBossCrew, findHangarBossAboard,
} from '../ecs/crewRoles'

// Idempotent: aligns the ship-interior world to the flagship's roster. The
// `ship` argument is the roster that changed (hire/fire target); the
// interior always reflects the *flagship* regardless, since only the
// boarded hull's crew are bodied. Callers just trigger a reconcile after
// any roster mutation. Extras (crew bodies not on the flagship roster,
// including a former flagship's crew after a switch) are destroyed; a
// roster key already aboard stays; a key found in another scene is
// relocated in; a key with no body anywhere is spawned fresh (name = key —
// only hit when identity was never persisted; the crewAboard save handler
// re-materializes real identity first on load).
export function reconcileCrewAboard(_ship?: Entity): void {
  void _ship
  const shipWorld = getWorld(SHIP_SCENE_ID)
  const flagship = flagshipEntity()
  const desired = flagship ? crewKeysForShip(flagship) : []
  const desiredSet = new Set(desired)

  // Trim any crew body not on the flagship roster; index the survivors.
  const existing = new Map<string, Entity>()
  for (const e of shipWorld.query(Character, EmployedAsCrew, EntityKey)) {
    const key = e.get(EntityKey)!.key
    if (!desiredSet.has(key)) { e.destroy(); continue }
    existing.set(key, e)
  }
  if (!flagship) return

  const flagshipKey = flagship.get(EntityKey)?.key ?? ''
  const pos = crewSpawnPosForShip(flagship)
  desired.forEach((key, ordinal) => {
    const role = roleForKey(flagship, key)
    const anchor = stationAnchorForOrdinal(flagship, ordinal)
    const aboard = existing.get(key)
    if (aboard) {
      ensureCrewMarkers(aboard, flagshipKey, role, anchor)
      return
    }
    const elsewhere = findCrewBodyElsewhere(key)
    if (elsewhere) {
      ensureCrewMarkers(migrateNpcEntity(elsewhere, shipWorld, pos), flagshipKey, role, anchor)
      return
    }
    const fresh = spawnNPC(shipWorld, {
      name: key, color: '#cccccc', x: pos.x, y: pos.y, key,
    })
    ensureCrewMarkers(fresh, flagshipKey, role, anchor)
  })
}
