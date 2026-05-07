import { Vec2 } from './types'
import { ShipKinematics, ThrustInput, vecLen } from './integration'

export interface AutopilotResult {
  thrust: ThrustInput
  arrived: boolean
}

// Steering autopilot. We pick a desired-velocity vector — direction toward
// the target, magnitude kinematically ramped down so the ship can decelerate
// to arrivalSpeed by the time it reaches arrivalRadius — and thrust along
// (desiredVel - currentVel). Steering against the velocity error (not the
// position error) is what kills lateral drift: a ship cruising at maxSpeed
// perpendicular to the target would otherwise rotate around it forever,
// because raw thrust-toward-target can only swing the velocity vector when
// speed is already clamped, never shrink the perpendicular component.
export function thrustToward(
  k: ShipKinematics,
  target: Vec2,
  thrustAccel: number,
  maxSpeed: number,
  arrivalRadius: number,
  arrivalSpeed: number = maxSpeed * 0.05,
): AutopilotResult {
  const dx = target.x - k.pos.x
  const dy = target.y - k.pos.y
  const distance = Math.hypot(dx, dy)
  const speed = vecLen(k.vel)

  if (distance < arrivalRadius && speed < arrivalSpeed) {
    const ax = speed > 0 ? -k.vel.x * thrustAccel / Math.max(speed, 1e-6) : 0
    const ay = speed > 0 ? -k.vel.y * thrustAccel / Math.max(speed, 1e-6) : 0
    return { thrust: { ax, ay }, arrived: true }
  }

  const distInv = distance > 0 ? 1 / distance : 0
  const safeDist = Math.max(distance - arrivalRadius, 0)
  const desiredSpeed = Math.min(
    maxSpeed,
    Math.sqrt(arrivalSpeed * arrivalSpeed + 2 * thrustAccel * safeDist),
  )
  const desiredVx = dx * distInv * desiredSpeed
  const desiredVy = dy * distInv * desiredSpeed
  const errX = desiredVx - k.vel.x
  const errY = desiredVy - k.vel.y
  const errMag = Math.hypot(errX, errY)
  if (errMag < 1e-6) return { thrust: { ax: 0, ay: 0 }, arrived: false }
  const inv = 1 / errMag
  return {
    thrust: { ax: errX * inv * thrustAccel, ay: errY * inv * thrustAccel },
    arrived: false,
  }
}
