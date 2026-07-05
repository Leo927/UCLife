import { describe, expect, it, beforeEach } from 'vitest'
import {
  useCpDp, issueFleetOrder, regenCommandPoints, dailyRefillCommandPoints,
  doctrineForAggression,
} from './fleetCommandPoints'
import { fleetConfig } from '../config'

describe('fleetCommandPoints — doctrine mapping', () => {
  it('maps each authored aggression id to its doctrine row', () => {
    const cautious = doctrineForAggression('cautious')
    const aggressive = doctrineForAggression('aggressive')
    // cautious holds at a wider standoff than aggressive (closes in).
    expect(cautious.maintainRangeMul).toBeGreaterThan(aggressive.maintainRangeMul)
    // aggressive presses harder (higher weapon-charge multiplier).
    expect(aggressive.aiAggression).toBeGreaterThan(cautious.aiAggression)
  })

  it('falls back to the default row for an unknown aggression id', () => {
    const fallback = doctrineForAggression('not-a-real-id')
    const def = doctrineForAggression(fleetConfig.aggressionDefault)
    expect(fallback).toEqual(def)
  })
})

describe('fleetCommandPoints — CP pool spend / refuse', () => {
  beforeEach(() => {
    useCpDp.getState().reset()
  })

  it('debits CP on a known order when the pool can cover it', () => {
    useCpDp.getState().setCp(5, 7)
    const cost = fleetConfig.commandPoints.orderCosts.rally
    const r = issueFleetOrder('rally')
    expect(r.ok).toBe(true)
    expect(useCpDp.getState().cpCurrent).toBe(5 - cost)
  })

  it('refuses an order when the pool is too low, without debiting', () => {
    useCpDp.getState().setCp(0, 7)
    const r = issueFleetOrder('rally')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('insufficient_cp')
    expect(useCpDp.getState().cpCurrent).toBe(0)
  })

  it('rejects an unknown order id', () => {
    useCpDp.getState().setCp(7, 7)
    const r = issueFleetOrder('teleport')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('unknown_order')
    expect(useCpDp.getState().cpCurrent).toBe(7)
  })
})

describe('fleetCommandPoints — CP regen', () => {
  beforeEach(() => {
    useCpDp.getState().reset()
  })

  it('accumulates fractional CP and only increments whole points', () => {
    useCpDp.getState().setCp(0, 7)
    const { regenPerSec } = fleetConfig.commandPoints
    // One sub-point tick: no whole point yet.
    const partialDt = 0.5 / regenPerSec   // accumulates 0.5 CP
    expect(regenCommandPoints(partialDt)).toBe(0)
    expect(useCpDp.getState().cpCurrent).toBe(0)
    // Another half — crosses a whole point.
    expect(regenCommandPoints(partialDt)).toBe(1)
    expect(useCpDp.getState().cpCurrent).toBe(1)
  })

  it('never regens past the pool max', () => {
    useCpDp.getState().setCp(7, 7)
    expect(regenCommandPoints(1000)).toBe(0)
    expect(useCpDp.getState().cpCurrent).toBe(7)
  })

  it('is a no-op when no engagement has seeded a pool (cpMax 0)', () => {
    useCpDp.getState().setCp(0, 0)
    expect(regenCommandPoints(1000)).toBe(0)
    expect(useCpDp.getState().cpCurrent).toBe(0)
  })
})

describe('fleetCommandPoints — daily campaign refill', () => {
  beforeEach(() => {
    useCpDp.getState().reset()
  })

  it('tops the pool up by the configured fraction, clamped to max', () => {
    useCpDp.getState().setCp(0, 8)
    dailyRefillCommandPoints()
    const expected = Math.min(8, Math.floor(8 * fleetConfig.commandPoints.dailyRefillFraction))
    expect(useCpDp.getState().cpCurrent).toBe(expected)
    // Pool stays integer-valued after refill.
    expect(Number.isInteger(useCpDp.getState().cpCurrent)).toBe(true)
  })

  it('is a no-op with no seeded pool', () => {
    useCpDp.getState().setCp(0, 0)
    dailyRefillCommandPoints()
    expect(useCpDp.getState().cpCurrent).toBe(0)
  })
})
