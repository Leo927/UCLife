// W1 final-review finding 1 — bootstrapSpaceCampaign always spawns an
// IsPlayer+ShipBody placeholder in spaceCampaign even before the player owns
// a flagship (W1 Task 5: the flagship is bought, not granted at boot).
// enemyAISystem gated targeting only on getDockedPoiId() (null with no
// flagship too), so a shipless player was visible to pirates — the starter
// picket would abandon its moon anchor to chase a placeholder with nobody
// aboard. Mirrors spaceSim.ts §6's immunity guard: the player is a valid
// target iff a flagship exists AND it isn't docked.
//
// Spawns directly into the real per-scene koota worlds (getWorld), same
// pattern as msCustody.test.ts — enemyAISystem and the sim/ship helpers it
// calls (getFlagshipEntity, getDockedPoiId) both read those singletons, so
// this is exercised the same way spaceSimSystem drives it in production.

import { afterEach, describe, expect, it } from 'vitest'
import type { Entity } from 'koota'
import {
  EnemyAI, Position, Velocity, Thrust, IsPlayer, ShipBody, EntityKey,
} from '../ecs/traits'
import { getWorld } from '../ecs/world'
import { enemyAISystem } from './enemyAI'

const SPACE_SCENE_ID = 'spaceCampaign'

const spawned: Entity[] = []

afterEach(() => {
  for (const e of spawned) e.destroy()
  spawned.length = 0
})

function spawnPlaceholderPlayer(pos: { x: number; y: number }): Entity {
  const w = getWorld(SPACE_SCENE_ID)
  const ent = w.spawn(
    IsPlayer(),
    ShipBody(),
    Position(pos),
    Velocity({ vx: 0, vy: 0 }),
    EntityKey({ key: 'spacePlayer-test' }),
  )
  spawned.push(ent)
  return ent
}

// Huge aggro radius so the enemy WOULD chase if the player were targetable —
// makes the assertion meaningful rather than passing by distance accident.
const HUGE_AGGRO_RADIUS = 50000

function spawnPatrolEnemy(pos: { x: number; y: number }): Entity {
  const w = getWorld(SPACE_SCENE_ID)
  const ent = w.spawn(
    EnemyAI({
      shipClassId: 'pirateLight',
      escorts: [],
      notableCaptains: {},
      mode: 'patrol',
      patrolPath: [pos, { x: pos.x + 100, y: pos.y }],
      patrolIdx: 0,
      aggroRadius: HUGE_AGGRO_RADIUS,
      fleeHullPct: 0.2,
      anchorBodyId: '',
      anchorOffset: { x: 0, y: 0 },
    }),
    Position({ ...pos }),
    Velocity({ vx: 0, vy: 0 }),
    Thrust({ ax: 0, ay: 0 }),
    EntityKey({ key: 'enemy-test' }),
  )
  spawned.push(ent)
  return ent
}

describe('enemyAISystem — no-flagship immunity', () => {
  it('shipless player (no flagship in playerShipInterior) must be invisible to pirates', () => {
    // Player placeholder sits right on top of the enemy — if targeting were
    // active, aggro would trigger unconditionally.
    spawnPlaceholderPlayer({ x: 1000, y: 1000 })
    const enemy = spawnPatrolEnemy({ x: 1000, y: 1000 })

    // No flagship exists anywhere (getFlagshipEntity reads playerShipInterior,
    // which this test never spawns a Ship+IsFlagshipMark entity into) — the
    // shipless-start state under test.
    enemyAISystem(getWorld(SPACE_SCENE_ID))

    expect(
      enemy.get(EnemyAI)!.mode,
      'shipless player must be invisible to pirates — enemy must never enter chase',
    ).not.toBe('chase')
  })
})
