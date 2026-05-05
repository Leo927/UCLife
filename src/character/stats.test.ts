import { describe, expect, it } from 'vitest'
import { attributesConfig } from '../config'
import { statMult, statInvMult } from './stats'

const { min, max } = attributesConfig.multiplierRange
const mid = (min + max) / 2

describe('statMult', () => {
  it('returns min at value=0', () => {
    expect(statMult(0)).toBeCloseTo(min, 10)
  })

  it('returns max at value=100', () => {
    expect(statMult(100)).toBeCloseTo(max, 10)
  })

  it('returns midpoint at value=50', () => {
    expect(statMult(50)).toBeCloseTo(mid, 10)
  })

  it('clamps negative input to min', () => {
    expect(statMult(-50)).toBeCloseTo(min, 10)
    expect(statMult(-Infinity)).toBeCloseTo(min, 10)
  })

  it('clamps input >100 to max', () => {
    expect(statMult(150)).toBeCloseTo(max, 10)
    expect(statMult(Infinity)).toBeCloseTo(max, 10)
  })

  it('is strictly monotonic on [0,100]', () => {
    let prev = statMult(0)
    for (let v = 1; v <= 100; v++) {
      const cur = statMult(v)
      expect(cur).toBeGreaterThan(prev)
      prev = cur
    }
  })
})

describe('statInvMult', () => {
  it('returns max at value=0', () => {
    expect(statInvMult(0)).toBeCloseTo(max, 10)
  })

  it('returns min at value=100', () => {
    expect(statInvMult(100)).toBeCloseTo(min, 10)
  })

  it('returns midpoint at value=50', () => {
    expect(statInvMult(50)).toBeCloseTo(mid, 10)
  })

  it('clamps negative input to max', () => {
    expect(statInvMult(-50)).toBeCloseTo(max, 10)
  })

  it('clamps input >100 to min', () => {
    expect(statInvMult(150)).toBeCloseTo(min, 10)
  })

  it('is strictly monotonically decreasing on [0,100]', () => {
    let prev = statInvMult(0)
    for (let v = 1; v <= 100; v++) {
      const cur = statInvMult(v)
      expect(cur).toBeLessThan(prev)
      prev = cur
    }
  })
})

describe('statMult + statInvMult reciprocity', () => {
  it('sums to min+max for any value in [0,100]', () => {
    for (const v of [0, 1, 17, 50, 73, 99, 100]) {
      expect(statMult(v) + statInvMult(v)).toBeCloseTo(min + max, 10)
    }
  })
})
