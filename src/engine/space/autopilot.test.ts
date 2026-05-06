import { describe, it, expect } from 'vitest'
import { thrustToward } from './autopilot'

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
})
