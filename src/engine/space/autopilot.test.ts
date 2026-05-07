import { describe, it, expect } from 'vitest'
import { thrustToward } from './autopilot'
import { step, type ShipKinematics } from './integration'
import type { Vec2 } from './types'

describe('thrustToward', () => {
  it('thrusts toward target when stationary', () => {
    const k = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } }
    const result = thrustToward(k, { x: 100, y: 0 }, 1, 100, 5)
    expect(result.arrived).toBe(false)
    expect(result.thrust.ax).toBeGreaterThan(0)
    expect(result.thrust.ay).toBeCloseTo(0)
  })

  it('returns arrived when within arrival radius and speed is low', () => {
    const k = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } }
    const result = thrustToward(k, { x: 2, y: 0 }, 1, 100, 5)
    expect(result.arrived).toBe(true)
  })

  it('brakes when moving toward target and within stopping distance', () => {
    // Ship at origin, target at (0, 40), moving toward it at speed 10
    // approachVel = 10, brakingDistance = 100/2 = 50 > 40 → brake mode
    const k = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 10 } }
    const result = thrustToward(k, { x: 0, y: 40 }, 1, 100, 5)
    expect(result.arrived).toBe(false)
    // Counter-thrust against approach velocity → ay should be negative
    expect(result.thrust.ay).toBeLessThan(0)
  })

  it('thrusts toward target when velocity is orthogonal to target direction', () => {
    // Bug case: ship at origin moving right (x), target directly above (y).
    // With old code: total speed = 10, brakingDistance = 50 > 45 → brake mode (wrong).
    // With fix: approachVel = vel·targetDir = (10,0)·(0,1) = 0, brakingDistance = 0 → thrust toward target.
    const k = { pos: { x: 0, y: 0 }, vel: { x: 10, y: 0 } }
    const result = thrustToward(k, { x: 0, y: 45 }, 1, 100, 5)
    expect(result.arrived).toBe(false)
    // Must thrust toward the target (y direction positive), not brake against lateral velocity
    expect(result.thrust.ay).toBeGreaterThan(0)
  })

  it('thrusts toward target when moving away from it', () => {
    // Ship moving away from target: approachVel < 0 → no braking needed, thrust toward target
    const k = { pos: { x: 0, y: 0 }, vel: { x: 0, y: -10 } }
    const result = thrustToward(k, { x: 0, y: 100 }, 1, 100, 5)
    expect(result.arrived).toBe(false)
    expect(result.thrust.ay).toBeGreaterThan(0)
  })

  it('does not orbit indefinitely when cruising at max speed perpendicular to target', () => {
    // Bug: at max speed perpendicular to the target, lateral velocity never
    // decays because the controller only counters approach velocity. The
    // ship circles the target forever.
    const maxSpeed = 100
    const thrustAccel = 50
    const arrivalRadius = 5
    let k: ShipKinematics = { pos: { x: 0, y: 0 }, vel: { x: maxSpeed, y: 0 } }
    const target: Vec2 = { x: 0, y: 200 }
    let arrived = false
    for (let i = 0; i < 60 * 30; i++) {
      const r = thrustToward(k, target, thrustAccel, maxSpeed, arrivalRadius)
      if (r.arrived) {
        arrived = true
        break
      }
      k = step(k, r.thrust, maxSpeed, 1 / 60)
    }
    expect(arrived).toBe(true)
  })
})
