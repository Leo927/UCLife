// Per-frame AI tick for spaceCampaign enemy ships. Reads the player's
// position and steers each EnemyAI entity according to its mode:
//   - patrol: thrust toward current waypoint, advance index on proximity
//   - chase: thrust toward player position
//   - flee: thrust away from player
//   - idle: zero thrust
// Mode transitions:
//   - patrol/idle -> chase when player within aggroRadius
//   - chase -> patrol when player exits 1.5x aggroRadius (hysteresis)
//   - any -> flee when hull < fleeHullPct (slice 7 wires hull; for now
//     enemies have no hull tracking so the flee branch is reachable only
//     by external state changes — kept as data path for slice 7)
//
// Wired into spaceSimSystem before the ship-physics step so enemy Thrust
// gets integrated by the same per-frame loop.

import type { World } from 'koota'
import { Position, Velocity, Thrust, EnemyAI, IsPlayer, ShipBody, Body } from '../ecs/traits'
import { thrustToward } from '../engine/space'
import { spaceConfig } from '../config'
import { inAggroRadius, distSq } from '../engine/space/engagement'
import { getDockedPoiId } from '../sim/ship'

export function enemyAISystem(world: World): void {
  // A docked player ship is parked at a POI and not a valid target — pirates
  // ignore it so they don't path toward Von Braun while the player walks
  // around the city. Aggro only resumes once the player undocks.
  const playerDocked = !!getDockedPoiId()
  let playerPos: { x: number; y: number } | null = null
  if (!playerDocked) {
    for (const e of world.query(IsPlayer, ShipBody, Position)) {
      playerPos = e.get(Position)!
      break
    }
  }

  const maxSpeed = spaceConfig.baseShipMaxSpeed * spaceConfig.shipSpeedScale * spaceConfig.enemyAi.speedFactor

  // Live celestial-body positions (updated by spaceSim §2 before this system),
  // used to resolve orbit-anchored patrols against their body's current spot.
  const bodyPos = new Map<string, { x: number; y: number }>()
  for (const b of world.query(Body, Position)) {
    bodyPos.set(b.get(Body)!.bodyId, b.get(Position)!)
  }

  for (const e of world.query(EnemyAI, Position, Velocity, Thrust)) {
    const ai = e.get(EnemyAI)!
    const pos = e.get(Position)!
    const vel = e.get(Velocity)!

    let mode = ai.mode
    if (playerPos) {
      if ((mode === 'patrol' || mode === 'idle') && inAggroRadius(pos, playerPos, ai.aggroRadius)) {
        mode = 'chase'
      } else if (mode === 'chase' && !inAggroRadius(pos, playerPos, ai.aggroRadius * spaceConfig.enemyAi.chaseHysteresis)) {
        mode = 'patrol'
      }
    }

    // Orbit-anchored enemies rigidly ride their body at a fixed offset while
    // not engaged — a direct position set (not physics) so the fast-jumping,
    // clock-driven moon can't leave them behind under coarse sim steps. Aggro
    // still breaks them off to chase/flee below.
    const anchorLive = ai.anchorBodyId ? bodyPos.get(ai.anchorBodyId) : undefined
    if (anchorLive && (mode === 'patrol' || mode === 'idle')) {
      e.set(Position, { x: anchorLive.x + ai.anchorOffset.x, y: anchorLive.y + ai.anchorOffset.y })
      e.set(Velocity, { vx: 0, vy: 0 })
      e.set(Thrust, { ax: 0, ay: 0 })
      if (mode !== ai.mode) e.set(EnemyAI, { ...ai, mode })
      continue
    }

    let target: { x: number; y: number } | null = null
    let advancePatrol = false

    if (mode === 'chase' && playerPos) {
      target = playerPos
    } else if (mode === 'flee' && playerPos) {
      const dx = pos.x - playerPos.x
      const dy = pos.y - playerPos.y
      const len = Math.hypot(dx, dy) || 1
      target = { x: pos.x + (dx / len) * 1000, y: pos.y + (dy / len) * 1000 }
    } else if (mode === 'patrol' && ai.patrolPath.length > 0) {
      target = ai.patrolPath[ai.patrolIdx % ai.patrolPath.length]
      const waypointR = spaceConfig.enemyAi.patrolWaypointRadiusPx
      if (distSq(pos, target) < waypointR * waypointR) {
        advancePatrol = true
      }
    }

    if (target) {
      const r = thrustToward(
        { pos, vel: { x: vel.vx, y: vel.vy } },
        target,
        spaceConfig.thrustAccel,
        maxSpeed,
        24,
      )
      e.set(Thrust, { ax: r.thrust.ax, ay: r.thrust.ay })
    } else {
      e.set(Thrust, { ax: 0, ay: 0 })
    }

    if (mode !== ai.mode || advancePatrol) {
      e.set(EnemyAI, {
        ...ai,
        mode,
        patrolIdx: advancePatrol
          ? (ai.patrolIdx + 1) % Math.max(1, ai.patrolPath.length)
          : ai.patrolIdx,
      })
    }
  }
}
