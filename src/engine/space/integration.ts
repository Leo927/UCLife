import { Vec2 } from './types'

export interface ShipKinematics {
  pos: Vec2
  vel: Vec2
}

export interface ThrustInput {
  ax: number
  ay: number
}

export function vecLen(v: Vec2): number {
  return Math.hypot(v.x, v.y)
}

// Semi-implicit Euler: integrate velocity first (so the new velocity drives
// the position update), then clamp to maxSpeed, then advance position. No
// drag — coasting is intentional in this engine.
export function step(
  k: ShipKinematics,
  thrust: ThrustInput,
  maxSpeed: number,
  dtSec: number,
): ShipKinematics {
  let vx = k.vel.x + thrust.ax * dtSec
  let vy = k.vel.y + thrust.ay * dtSec

  const speed = Math.hypot(vx, vy)
  if (maxSpeed > 0 && speed > maxSpeed) {
    const scale = maxSpeed / speed
    vx *= scale
    vy *= scale
  }

  return {
    pos: { x: k.pos.x + vx * dtSec, y: k.pos.y + vy * dtSec },
    vel: { x: vx, y: vy },
  }
}
