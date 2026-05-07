import type { World } from 'koota'
import { useClock, getSmoothedGameMs } from '../sim/clock'
import { spaceConfig } from '../config'
import { CELESTIAL_BODIES } from '../data/celestialBodies'
import { POIS } from '../data/pois'
import {
  Position, Body, PoiTag, ShipBody, Velocity, Thrust, Course,
  EnemyAI, EntityKey, IsPlayer,
} from '../ecs/traits'
import { derivedPos } from '../engine/space/orbits'
import type { ParentResolver, OrbitalParams } from '../engine/space/types'
import { step } from '../engine/space/integration'
import { thrustToward } from '../engine/space/autopilot'
import { contact } from '../engine/space/engagement'
import { enemyAISystem } from './enemyAI'
import { useEngagement } from '../sim/engagement'
import { spendFuel, getShipState, getDockedPoiId, setDockedPoi, setFleetPos } from '../sim/ship'
import { emitSim } from '../sim/events'

const MS_PER_DAY = 24 * 60 * 60 * 1000

const bodyById = new Map(CELESTIAL_BODIES.map((b) => [b.id, b]))
const poiById = new Map(POIS.map((p) => [p.id, p]))

const resolveBody: ParentResolver = (id: string): OrbitalParams | undefined => {
  const b = bodyById.get(id)
  if (!b) return undefined
  return {
    parentId: b.parentId ?? null,
    pos: b.pos,
    orbitRadius: b.orbitRadius,
    orbitPeriodDays: b.orbitPeriodDays,
    orbitPhase: b.orbitPhase,
  }
}

// per-active-scene only: spaceSim ticks exclusively against the
// 'spaceCampaign' world (loop.ts gates by scene id). Cooldowns are keyed
// by EntityKey strings (save-unique), and only one player ship exists, so
// module-scope state is safe — there is no second concurrent space scene.
const ENGAGEMENT_COOLDOWN_MS = 5000
const engagementCooldownByKey = new Map<string, number>()
const enemyOutOfAggro = new Set<string>()

// per-active-scene only: edge-triggered "燃料耗尽" log; flips true once
// when fuel runs out and back to false on refill, so a single exhaustion
// logs once across many frames.
let fuelOutLogged = false

// Save/load and resetWorld() call this so the next exhaustion logs cleanly
// after a fuel refill that happens off-frame.
export function resetSpaceSimFlags(): void {
  fuelOutLogged = false
  engagementCooldownByKey.clear()
  enemyOutOfAggro.clear()
}

// One frame of the spaceCampaign sim. Caller is loop.ts; frequency ~60Hz.
// Slice 4 runs this only when the camera is on the spaceCampaign scene.
// Slice 5 lifts that gate so off-helm autopilot continues.
// Slice 6 adds enemy AI + engagement contact detection; the whole sim
// freezes while the engagement modal is open or a tactical engagement
// is active — orbits, autopilot, fuel drain, and pirate AI all halt
// while the player is in combat.
export function spaceSimSystem(world: World, dtSec: number): void {
  // Pause integration while the engagement modal is open — Starsector-
  // style "world pauses on contact" feel.
  if (useEngagement.getState().open) return
  // Pause the campaign world for the duration of a tactical engagement.
  // Without this, orbits march on, other pirates close in, and the
  // player's autopilot keeps integrating while they're at the bridge.
  if (useClock.getState().mode === 'combat') return

  // 1. Derived t in days, scaled by orbitTimeScale. Use the smoothed clock
  // so orbits advance continuously between integer-minute ticks (otherwise
  // bodies snap forward once per real-second at speed 1, which reads as
  // "low FPS" while the camera-locked ship moves smoothly).
  const gameMs = getSmoothedGameMs()
  const tDays = (gameMs / MS_PER_DAY) * spaceConfig.orbitTimeScale

  // 2. Recompute Position for every Body and PoiTag entity.
  for (const e of world.query(Body, Position)) {
    const id = e.get(Body)!.bodyId
    const params = resolveBody(id)
    if (!params) continue
    e.set(Position, derivedPos(params, tDays, resolveBody))
  }
  // Cache live POI positions by id this frame so the autopilot retarget
  // loop below is O(1) instead of doing an O(N) world.query per ship.
  const poiPosById = new Map<string, { x: number; y: number }>()
  for (const e of world.query(PoiTag, Position)) {
    const poiId = e.get(PoiTag)!.poiId
    const p = poiById.get(poiId)
    if (!p) continue
    const parent = resolveBody(p.bodyId)
    if (!parent) continue
    const poiParams: OrbitalParams = {
      parentId: p.bodyId,
      orbitRadius: p.orbitRadius,
      orbitPeriodDays: p.orbitPeriodDays,
      orbitPhase: p.orbitPhase,
    }
    const pos = derivedPos(poiParams, tDays, resolveBody)
    e.set(Position, pos)
    poiPosById.set(poiId, pos)
  }

  // Pin a docked player ship to the live POI position. Without this the
  // POI orbits its parent each frame while the ship stays put in absolute
  // space, reading as drift even though the player issued no command.
  const dockedPoiId = getDockedPoiId()
  if (dockedPoiId) {
    const dp = poiPosById.get(dockedPoiId)
    if (dp) {
      for (const pe of world.query(IsPlayer, ShipBody, Position, Velocity)) {
        pe.set(Position, { x: dp.x, y: dp.y })
        pe.set(Velocity, { vx: 0, vy: 0 })
        setFleetPos(dp)
      }
    }
  }

  // 3. Enemy AI fills Thrust on EnemyAI entities before integration.
  enemyAISystem(world)

  // 4. For each ship: autopilot fills Thrust if Course.active, then step.
  const maxSpeed = spaceConfig.baseShipMaxSpeed * spaceConfig.shipSpeedScale
  for (const e of world.query(ShipBody, Position, Velocity, Thrust, Course)) {
    const pos = e.get(Position)!
    const vel = e.get(Velocity)!
    const course = e.get(Course)!

    if (course.active) {
      // If destPoiId set, retarget to the live POI position each frame.
      let tx = course.tx
      let ty = course.ty
      if (course.destPoiId) {
        const pp = poiPosById.get(course.destPoiId)
        if (pp) {
          tx = pp.x
          ty = pp.y
        }
      }
      const r = thrustToward(
        { pos, vel: { x: vel.vx, y: vel.vy } },
        { x: tx, y: ty },
        spaceConfig.thrustAccel,
        maxSpeed,
        spaceConfig.dockSnapRadius,
      )
      e.set(Thrust, { ax: r.thrust.ax, ay: r.thrust.ay })
      if (r.arrived) {
        e.set(Course, { ...course, active: false, autoDock: false })
        // autoDock courses (set by dockAt() in navigation.ts) snap the
        // dock binding when the ship reaches the destination POI. Pure
        // navigate-to-point arrivals just halt — no dock side effect.
        if (course.autoDock && course.destPoiId) {
          setDockedPoi(course.destPoiId, { x: tx, y: ty })
          setFleetPos({ x: tx, y: ty })
          e.set(Position, { x: tx, y: ty })
          e.set(Velocity, { vx: 0, vy: 0 })
          const poi = poiById.get(course.destPoiId)
          emitSim('log', {
            textZh: `已停泊 · ${poi?.nameZh ?? course.destPoiId}`,
            atMs: useClock.getState().gameDate.getTime(),
          })
        }
      }
    }

    const thrust = e.get(Thrust)!
    // Fuel economy: debit proportional to actual delta-v after the
    // maxSpeed clamp, not commanded thrust. Cruising at maxSpeed in a
    // straight line burns nothing because the integrator throws the
    // overshoot away — fuel only buys real changes in velocity
    // (spin-up, braking, turning). When fuel is empty, computed thrust
    // is dropped (player coasts) but Course stays active so a refuel
    // mid-flight resumes the autopilot.
    let appliedAx = thrust.ax
    let appliedAy = thrust.ay
    const thrustMag = Math.hypot(thrust.ax, thrust.ay)
    if (thrustMag > 0) {
      // Predict post-clamp delta-v using the same math as the
      // integrator (semi-implicit Euler + maxSpeed clamp), so the
      // charge matches what the next step() actually applies.
      const tentVx = vel.vx + thrust.ax * dtSec
      const tentVy = vel.vy + thrust.ay * dtSec
      const tentSpeed = Math.hypot(tentVx, tentVy)
      let nextVx = tentVx
      let nextVy = tentVy
      if (maxSpeed > 0 && tentSpeed > maxSpeed) {
        const scale = maxSpeed / tentSpeed
        nextVx *= scale
        nextVy *= scale
      }
      const deltaV = Math.hypot(nextVx - vel.vx, nextVy - vel.vy)
      if (deltaV > 0) {
        const fuelSpent = deltaV * spaceConfig.fuelPerThrustSec / spaceConfig.thrustAccel
        const ok = spendFuel(fuelSpent)
        const ship = getShipState()
        if (!ok || (ship && ship.fuelCurrent <= 0)) {
          appliedAx = 0
          appliedAy = 0
          if (!fuelOutLogged) {
            fuelOutLogged = true
            emitSim('log', { textZh: '燃料耗尽', atMs: useClock.getState().gameDate.getTime() })
          }
        } else if (ship && ship.fuelCurrent > 0) {
          fuelOutLogged = false
        }
      }
    } else {
      const ship = getShipState()
      if (ship && ship.fuelCurrent > 0) fuelOutLogged = false
    }
    const k = step(
      { pos, vel: { x: vel.vx, y: vel.vy } },
      { ax: appliedAx, ay: appliedAy },
      maxSpeed,
      dtSec,
    )
    e.set(Position, k.pos)
    e.set(Velocity, { vx: k.vel.x, vy: k.vel.y })
    // Reset thrust each frame — input/autopilot reapplies next tick.
    e.set(Thrust, { ax: 0, ay: 0 })
  }

  // 5. Integrate enemy ships separately so player-ship gates (ShipBody +
  // Course) stay scoped to the player. Enemies use the same integrator
  // and same maxSpeed bound as the player; per-faction tuning lives in
  // enemyAISystem (target speed, thrustAccel scaling).
  const enemyMaxSpeed = maxSpeed * 0.85
  for (const e of world.query(EnemyAI, Position, Velocity, Thrust)) {
    const pos = e.get(Position)!
    const vel = e.get(Velocity)!
    const thrust = e.get(Thrust)!
    const k = step(
      { pos, vel: { x: vel.vx, y: vel.vy } },
      { ax: thrust.ax, ay: thrust.ay },
      enemyMaxSpeed,
      dtSec,
    )
    e.set(Position, k.pos)
    e.set(Velocity, { vx: k.vel.x, vy: k.vel.y })
    e.set(Thrust, { ax: 0, ay: 0 })
  }

  // 6. Contact detection — if the player ship comes within
  // aggroContactRadius of an enemy, prompt the engagement modal. Cooldown
  // + "must exit aggro before re-prompting" guards prevent the modal from
  // re-firing on every frame while inside contact range. A docked ship
  // is parked and immune; the modal must never fire while the player is
  // walking around the city or ship interior.
  let playerPos: { x: number; y: number } | null = null
  const playerDocked = !!getDockedPoiId()
  if (!playerDocked) {
    for (const pe of world.query(IsPlayer, ShipBody, Position)) {
      playerPos = pe.get(Position)!
      break
    }
  }
  if (playerPos && !useEngagement.getState().open) {
    const contactR = spaceConfig.aggroContactRadius
    const nowMs = Date.now()
    for (const e of world.query(EnemyAI, Position, EntityKey)) {
      const ai = e.get(EnemyAI)!
      const ePos = e.get(Position)!
      const ek = e.get(EntityKey)!.key
      const inContact = contact(playerPos, ePos, contactR)
      if (!inContact) {
        // Mark this enemy as having exited aggro for re-prompt eligibility.
        enemyOutOfAggro.add(ek)
        continue
      }
      const cooldownUntil = engagementCooldownByKey.get(ek) ?? 0
      if (nowMs < cooldownUntil) continue
      if (!enemyOutOfAggro.has(ek) && engagementCooldownByKey.has(ek)) {
        // Still inside contact since last resolve — don't re-prompt.
        continue
      }
      enemyOutOfAggro.delete(ek)
      engagementCooldownByKey.set(ek, nowMs + ENGAGEMENT_COOLDOWN_MS)
      useEngagement.getState().prompt(ek, ai.shipClassId, ai.escorts)
      break
    }
  }
}
