import { describe, expect, it } from 'vitest'
import { SeededRng } from './rng'

describe('SeededRng.fromNumber', () => {
  it('produces identical streams for identical seeds', () => {
    const a = SeededRng.fromNumber(12345)
    const b = SeededRng.fromNumber(12345)
    const seqA = Array.from({ length: 16 }, () => a.uniform())
    const seqB = Array.from({ length: 16 }, () => b.uniform())
    expect(seqA).toEqual(seqB)
  })

  it('produces different streams for different seeds', () => {
    const a = Array.from({ length: 8 }, (() => {
      const r = SeededRng.fromNumber(1)
      return () => r.uniform()
    })())
    const b = Array.from({ length: 8 }, (() => {
      const r = SeededRng.fromNumber(2)
      return () => r.uniform()
    })())
    expect(a).not.toEqual(b)
  })
})

describe('SeededRng.fromString', () => {
  it('is deterministic for identical strings', () => {
    const a = SeededRng.fromString('Von Braun')
    const b = SeededRng.fromString('Von Braun')
    expect(a.uniform()).toBe(b.uniform())
  })

  it('produces a different stream for an empty string vs "a"', () => {
    const a = SeededRng.fromString('')
    const b = SeededRng.fromString('a')
    expect(a.uniform()).not.toBe(b.uniform())
  })
})

describe('SeededRng.uniform', () => {
  it('returns values in [0, 1)', () => {
    const r = SeededRng.fromNumber(7)
    for (let i = 0; i < 100; i++) {
      const u = r.uniform()
      expect(u).toBeGreaterThanOrEqual(0)
      expect(u).toBeLessThan(1)
    }
  })
})

describe('SeededRng.intRange', () => {
  it('returns values inclusive on both ends', () => {
    const r = SeededRng.fromNumber(99)
    const seen = new Set<number>()
    for (let i = 0; i < 500; i++) seen.add(r.intRange(3, 7))
    for (const v of seen) {
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(3)
      expect(v).toBeLessThanOrEqual(7)
    }
    // Across 500 draws on a 5-value range, every value should appear at least once.
    expect(seen.size).toBe(5)
  })

  it('handles single-element ranges', () => {
    const r = SeededRng.fromNumber(1)
    for (let i = 0; i < 16; i++) expect(r.intRange(4, 4)).toBe(4)
  })
})

describe('SeededRng.pick', () => {
  it('returns an element from the input array', () => {
    const r = SeededRng.fromNumber(1)
    const arr = ['x', 'y', 'z'] as const
    for (let i = 0; i < 32; i++) expect(arr).toContain(r.pick(arr))
  })

  it('throws on empty input', () => {
    const r = SeededRng.fromNumber(1)
    expect(() => r.pick([])).toThrow(/empty/)
  })
})

describe('SeededRng.fork', () => {
  it('advances parent state by one draw per fork', () => {
    // fork() docs: "Advance our state once so the fork doesn't replay our
    // next draw." Two successive forks must therefore see the parent state
    // twice-shifted, so children A and B start from different states.
    const parent = SeededRng.fromNumber(42)
    const childA = parent.fork()
    const childB = parent.fork()
    expect(childA.uniform()).not.toBe(childB.uniform())
  })

  it('does not affect the parent after the fork is consumed', () => {
    const a = SeededRng.fromNumber(7)
    a.fork()              // discarded
    const aDraws = Array.from({ length: 8 }, () => a.uniform())

    const b = SeededRng.fromNumber(7)
    b.fork()              // discarded — same fork advance as above
    const bDraws = Array.from({ length: 8 }, () => b.uniform())

    expect(aDraws).toEqual(bDraws)
  })

  it('does not let two independent SeededRng instances interleave', () => {
    // The wrap-and-restore pattern in run() must protect rot-js's global
    // RNG state across instances. Interleaving draws from two instances
    // must give the same result as draining each separately.
    const a1 = SeededRng.fromNumber(11)
    const b1 = SeededRng.fromNumber(22)
    const interleaved: number[] = []
    for (let i = 0; i < 8; i++) {
      interleaved.push(a1.uniform())
      interleaved.push(b1.uniform())
    }

    const a2 = SeededRng.fromNumber(11)
    const b2 = SeededRng.fromNumber(22)
    const aOnly = Array.from({ length: 8 }, () => a2.uniform())
    const bOnly = Array.from({ length: 8 }, () => b2.uniform())
    const sequential: number[] = []
    for (let i = 0; i < 8; i++) {
      sequential.push(aOnly[i])
      sequential.push(bOnly[i])
    }

    expect(interleaved).toEqual(sequential)
  })
})
