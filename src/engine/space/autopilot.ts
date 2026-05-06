import { Vec2 } from './types'
import { ShipKinematics, ThrustInput, vecLen } from './integration'

export interface AutopilotResult {
  thrust: ThrustInput
  arrived: boolean
}

// Braking margin (px) added to the kinematic stopping distance before we
// switch from accel-toward-target to brake-against-velocity. Without it the
// ship oscillates around the switch boundary; ~5% of typical thrustAccel
// is plenty given the semi-implicit integrator.
const BRAKING_MARGIN_PX = 4

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
    // Counter-thrust to bleed off residual drift; integrator clamps actual a.
    const ax = speed > 0 ? -k.vel.x * thrustAccel / Math.max(speed, 1e-6) : 0
    const ay = speed > 0 ? -k.vel.y * thrustAccel / Math.max(speed, 1e-6) : 0
    return { thrust: { ax, ay }, arrived: true }
  }

  // Use only the approach velocity (component toward target) for braking distance.
  // Total speed would include lateral (perpendicular) velocity that cannot cause overshoot,
  // which made the ship enter brake mode unnecessarily and orbit the target.
  const distInv = distance > 0 ? 1 / distance : 0
  const approachVel = (k.vel.x * dx + k.vel.y * dy) * distInv
  const brakingDistance =
    approachVel > 0 && thrustAccel > 0 ? (approachVel * approachVel) / (2 * thrustAccel) : 0

  if (distance > brakingDistance + BRAKING_MARGIN_PX) {
    return {
      thrust: { ax: dx * distInv * thrustAccel, ay: dy * distInv * thrustAccel },
      arrived: false,
    }
  }

  if (speed > 0) {
    const inv = 1 / speed
    return {
      thrust: { ax: -k.vel.x * inv * thrustAccel, ay: -k.vel.y * inv * thrustAccel },
      arrived: false,
    }
  }

  return { thrust: { ax: 0, ay: 0 }, arrived: false }
}
