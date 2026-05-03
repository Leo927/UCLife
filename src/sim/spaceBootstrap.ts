// Bootstraps the spaceCampaign world: spawns body + POI entities, plus
// the player ship at the docked POI's derived t=0 position. Enemies are
// slice 6.

import { getWorld } from '../ecs/world'
import {
  Body, PoiTag, ShipBody, Velocity, Thrust, Course,
  Position, IsPlayer, EntityKey, EnemyAI,
} from '../ecs/traits'
import { CELESTIAL_BODIES } from '../data/celestialBodies'
import { POIS } from '../data/pois'
import { SPACE_ENTITIES } from '../data/space-entities'
import { derivedPos } from '../engine/space/orbits'
import type { ParentResolver, OrbitalParams } from '../engine/space/types'
import { getShipState } from './ship'

const SPACE_SCENE_ID = 'spaceCampaign'

function buildBodyResolver(): ParentResolver {
  const byId = new Map(CELESTIAL_BODIES.map((b) => [b.id, b]))
  return (id: string): OrbitalParams | undefined => {
    const b = byId.get(id)
    if (!b) return undefined
    return {
      parentId: b.parentId ?? null,
      pos: b.pos,
      orbitRadius: b.orbitRadius,
      orbitPeriodDays: b.orbitPeriodDays,
      orbitPhase: b.orbitPhase,
    }
  }
}

export function bootstrapSpaceCampaign(): void {
  const world = getWorld(SPACE_SCENE_ID)

  // Idempotent: clear all entities before spawning so a second call (e.g.
  // save/load reset path) doesn't double up bodies/POIs/player.
  for (const e of world.query()) e.destroy()

  const resolveBody = buildBodyResolver()

  // Bodies. Root body has explicit pos; others derive from orbit at t=0.
  for (const body of CELESTIAL_BODIES) {
    const params: OrbitalParams = {
      parentId: body.parentId ?? null,
      pos: body.pos,
      orbitRadius: body.orbitRadius,
      orbitPeriodDays: body.orbitPeriodDays,
      orbitPhase: body.orbitPhase,
    }
    const p = derivedPos(params, 0, resolveBody)
    world.spawn(
      Body({ bodyId: body.id }),
      Position({ x: p.x, y: p.y }),
      EntityKey({ key: `body-${body.id}` }),
    )
  }

  // POIs orbit a body — synthesize OrbitalParams with the host body as parent.
  for (const poi of POIS) {
    const poiParams: OrbitalParams = {
      parentId: poi.bodyId,
      orbitRadius: poi.orbitRadius,
      orbitPeriodDays: poi.orbitPeriodDays,
      orbitPhase: poi.orbitPhase,
    }
    const p = derivedPos(poiParams, 0, resolveBody)
    world.spawn(
      PoiTag({ poiId: poi.id }),
      Position({ x: p.x, y: p.y }),
      EntityKey({ key: `poi-${poi.id}` }),
    )
  }

  // Player. Spawn at the docked POI's t=0 position; default to vonBraun if
  // no ship state exists yet (e.g. fresh boot before ship-scene bootstrap).
  const dockedPoiId = getShipState()?.dockedAtPoiId ?? 'vonBraun'
  const docked = POIS.find((p) => p.id === dockedPoiId) ?? POIS.find((p) => p.id === 'vonBraun')
  let spawnPos = { x: 0, y: 0 }
  if (docked) {
    spawnPos = derivedPos(
      {
        parentId: docked.bodyId,
        orbitRadius: docked.orbitRadius,
        orbitPeriodDays: docked.orbitPeriodDays,
        orbitPhase: docked.orbitPhase,
      },
      0,
      resolveBody,
    )
  }

  // AtHelm is owned by the helm transition (sim/helm.ts), not the bootstrap.
  // The player exists here so spaceSimSystem can integrate motion from the
  // moment the campaign world is alive — slice 5 lifts the active-scene gate.
  world.spawn(
    IsPlayer,
    Position({ x: spawnPos.x, y: spawnPos.y }),
    ShipBody,
    Velocity({ vx: 0, vy: 0 }),
    Thrust({ ax: 0, ay: 0 }),
    Course({ tx: 0, ty: 0, destPoiId: null, active: false }),
    EntityKey({ key: 'spacePlayer' }),
  )

  // Hand-placed enemies. ShipBody is intentionally omitted — that marker
  // gates the player ship's autopilot path; enemies route through
  // enemyAISystem instead.
  for (const e of SPACE_ENTITIES) {
    world.spawn(
      Position({ x: e.spawn.x, y: e.spawn.y }),
      Velocity({ vx: 0, vy: 0 }),
      Thrust({ ax: 0, ay: 0 }),
      EnemyAI({
        shipClassId: e.shipClassId,
        mode: e.aiMode,
        patrolPath: [...(e.patrolPath ?? [])],
        patrolIdx: 0,
        aggroRadius: e.aggroRadius,
        fleeHullPct: e.fleeHullPct,
      }),
      EntityKey({ key: `enemy-${e.id}` }),
    )
  }
}
