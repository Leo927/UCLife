import { describe, expect, it } from 'vitest'
import {
  getSimRng,
  setSimRngSeed,
  getSimRngState,
  setSimRngState,
} from './rng'

describe('sim/rng — process-global seeded RNG', () => {
  it('produces identical sequences for identical seeds', () => {
    setSimRngSeed('abc')
    const a = Array.from({ length: 100 }, () => getSimRng().next())
    setSimRngSeed('abc')
    const b = Array.from({ length: 100 }, () => getSimRng().next())
    expect(a).toEqual(b)
  })

  it('produces different sequences for different seeds', () => {
    setSimRngSeed('seed-one')
    const a = Array.from({ length: 100 }, () => getSimRng().next())
    setSimRngSeed('seed-two')
    const b = Array.from({ length: 100 }, () => getSimRng().next())
    expect(a).not.toEqual(b)
  })

  it('accepts a numeric seed', () => {
    setSimRngSeed(42)
    const a = Array.from({ length: 16 }, () => getSimRng().next())
    setSimRngSeed(42)
    const b = Array.from({ length: 16 }, () => getSimRng().next())
    expect(a).toEqual(b)
  })

  it('next() returns values in [0, 1)', () => {
    setSimRngSeed('range-check')
    for (let i = 0; i < 200; i++) {
      const u = getSimRng().next()
      expect(u).toBeGreaterThanOrEqual(0)
      expect(u).toBeLessThan(1)
    }
  })

  it('int(min, max) returns integers inclusive on both ends', () => {
    setSimRngSeed('int-range')
    const seen = new Set<number>()
    for (let i = 0; i < 500; i++) seen.add(getSimRng().int(5, 10))
    for (const v of seen) {
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(5)
      expect(v).toBeLessThanOrEqual(10)
    }
    expect(seen.size).toBe(6)
  })

  it('int(n, n) always returns n', () => {
    setSimRngSeed('int-degenerate')
    for (let i = 0; i < 16; i++) expect(getSimRng().int(4, 4)).toBe(4)
  })

  it('pick() returns an element of the input array', () => {
    setSimRngSeed('pick')
    const arr = ['a', 'b', 'c'] as const
    for (let i = 0; i < 64; i++) expect(arr).toContain(getSimRng().pick(arr))
  })

  it('pick() on a long-enough trial samples every element', () => {
    setSimRngSeed('pick-coverage')
    const arr = ['x', 'y', 'z'] as const
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) seen.add(getSimRng().pick(arr))
    expect(seen.size).toBe(3)
  })

  it('pick() throws on empty input', () => {
    setSimRngSeed('pick-empty')
    expect(() => getSimRng().pick([])).toThrow()
  })

  it('getSimRngState / setSimRngState round-trip deterministically', () => {
    setSimRngSeed('round-trip')
    // Burn a few draws so we're capturing a mid-stream state, not the seed.
    for (let i = 0; i < 5; i++) getSimRng().next()
    const snapshot = getSimRngState()
    const a = Array.from({ length: 10 }, () => getSimRng().next())
    setSimRngState(snapshot)
    const b = Array.from({ length: 10 }, () => getSimRng().next())
    expect(a).toEqual(b)
  })

  it('setSimRngSeed is idempotent — re-seeding mid-stream resets to the same start', () => {
    setSimRngSeed('idempotent')
    const a = Array.from({ length: 8 }, () => getSimRng().next())
    // Take more numbers, then re-seed and re-take from the start.
    for (let i = 0; i < 50; i++) getSimRng().next()
    setSimRngSeed('idempotent')
    const b = Array.from({ length: 8 }, () => getSimRng().next())
    expect(a).toEqual(b)
  })
})
