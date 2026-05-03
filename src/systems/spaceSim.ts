import type { World } from 'koota'
import { useClock } from '../sim/clock'
import { spaceConfig } from '../config'
import { CELESTIAL_BODIES } from '../data/celestialBodies'
import { POIS } from '../data/pois'
import { Position, Body, PoiTag, ShipBody, Velocity, Thrust, Course } from '../ecs/traits'
import { derivedPos } from '../engine/space/orbits'
import type { ParentResolver, OrbitalParams } from '../engine/space/types'
import { step } from '../engine/space/integration'
import { thrustToward } from '../engine/space/autopilot'

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

// One frame of the spaceCampaign sim. Caller is loop.ts; frequency ~60Hz.
// Slice 4 runs this only when the camera is on the spaceCampaign scene.
// Slice 5 will lift that gate so off-helm autopilot continues.
export function spaceSimSystem(world: World, dtSec: number): void {
  // 1. Derived t in days, scaled by orbitTimeScale.
  const gameMs = useClock.getState().gameDate.getTime()
  const tDays = (gameMs / MS_PER_DAY) * spaceConfig.orbitTimeScale

  // 2. Recompute Position for every Body and PoiTag entity.
  for (const e of world.query(Body, Position)) {
    const id = e.get(Body)!.bodyId
    const params = resolveBody(id)
    if (!params) continue
    e.set(Position, derivedPos(params, tDays, resolveBody))
  }
  for (const e of world.query(PoiTag, Position)) {
    const p = poiById.get(e.get(PoiTag)!.poiId)
    if (!p) continue
    const parent = resolveBody(p.bodyId)
    if (!parent) continue
    const poiParams: OrbitalParams = {
      parentId: p.bodyId,
      orbitRadius: p.orbitRadius,
      orbitPeriodDays: p.orbitPeriodDays,
      orbitPhase: p.orbitPhase,
    }
    e.set(Position, derivedPos(poiParams, tDays, resolveBody))
  }

  // 3. For each ship: autopilot fills Thrust if Course.active, then step.
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
        for (const pe of world.query(PoiTag, Position)) {
          if (pe.get(PoiTag)!.poiId === course.destPoiId) {
            const pp = pe.get(Position)!
            tx = pp.x
            ty = pp.y
            break
          }
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
      if (r.arrived) e.set(Course, { ...course, active: false })
    }

    const thrust = e.get(Thrust)!
    const k = step(
      { pos, vel: { x: vel.vx, y: vel.vy } },
      { ax: thrust.ax, ay: thrust.ay },
      maxSpeed,
      dtSec,
    )
    e.set(Position, k.pos)
    e.set(Velocity, { vx: k.vel.x, vy: k.vel.y })
    // Reset thrust each frame — input/autopilot reapplies next tick.
    e.set(Thrust, { ax: 0, ay: 0 })
  }
}
