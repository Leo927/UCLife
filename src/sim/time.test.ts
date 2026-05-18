import { afterEach, describe, expect, it } from 'vitest'
import {
  advanceSimNow, freezeSimNow, isSimNowFrozen, setSimNow, simNow, unfreezeSimNow,
} from './time'

afterEach(() => {
  unfreezeSimNow()
})

describe('simNow (unfrozen)', () => {
  it('returns a value within 100ms of Date.now()', () => {
    const before = Date.now()
    const out = simNow()
    const after = Date.now()
    expect(out).toBeGreaterThanOrEqual(before)
    expect(out).toBeLessThanOrEqual(after + 100)
  })

  it('isSimNowFrozen() is false by default', () => {
    expect(isSimNowFrozen()).toBe(false)
  })
})

describe('simNow (frozen)', () => {
  it('freezeSimNow pins simNow() to the given ms', () => {
    freezeSimNow(1000)
    expect(simNow()).toBe(1000)
  })

  it('isSimNowFrozen() flips true after freeze and false after unfreeze', () => {
    freezeSimNow(1000)
    expect(isSimNowFrozen()).toBe(true)
    unfreezeSimNow()
    expect(isSimNowFrozen()).toBe(false)
  })

  it('advanceSimNow adds delta to the frozen value', () => {
    freezeSimNow(1000)
    advanceSimNow(500)
    expect(simNow()).toBe(1500)
    advanceSimNow(250)
    expect(simNow()).toBe(1750)
  })

  it('setSimNow overwrites the frozen value', () => {
    freezeSimNow(1000)
    setSimNow(9999)
    expect(simNow()).toBe(9999)
  })

  it('unfreezeSimNow restores wall-clock behaviour', () => {
    freezeSimNow(1000)
    unfreezeSimNow()
    expect(simNow()).toBeGreaterThan(1_000_000)
  })

  it('multiple freezes overwrite each other (no stacking)', () => {
    freezeSimNow(1000)
    freezeSimNow(2000)
    expect(simNow()).toBe(2000)
  })
})
