import { describe, expect, it } from 'vitest'
import { economyConfig } from '../config'
import type { JobSpec } from '../config'
import {
  dowLabel,
  isInWorkWindow,
  isWorkDay,
  wageMultiplier,
} from './jobs'

const w = economyConfig.wage

function spec(overrides: Partial<JobSpec> = {}): JobSpec {
  return {
    jobTitle: 'tester',
    wage: 100,
    skillXp: 0,
    skill: null,
    shiftStart: 9,
    shiftEnd: 17,
    workDays: [1, 2, 3, 4, 5],   // Mon..Fri
    requirements: {},
    description: '',
    playerHireable: true,
    ...overrides,
  }
}

describe('wageMultiplier', () => {
  it('returns 1.0 at or above fullPay', () => {
    expect(wageMultiplier(w.perfBreakpoints.fullPay)).toBe(1.0)
    expect(wageMultiplier(w.perfBreakpoints.fullPay + 50)).toBe(1.0)
  })

  it('uses the nearFull-band formula on (nearFull, fullPay)', () => {
    const perf = (w.perfBreakpoints.nearFull + w.perfBreakpoints.fullPay) / 2
    const expected = 1.0 - (w.perfBreakpoints.fullPay - perf) * w.perfSlopes.nearFull
    expect(wageMultiplier(perf)).toBeCloseTo(expected, 10)
  })

  it('joins nearFull→midRange continuously at perf = nearFull', () => {
    const perf = w.perfBreakpoints.nearFull
    const fromNearFull = 1.0 - (w.perfBreakpoints.fullPay - perf) * w.perfSlopes.nearFull
    expect(wageMultiplier(perf)).toBeCloseTo(fromNearFull, 10)
    expect(wageMultiplier(perf)).toBeCloseTo(w.midRangeBaseMult, 10)
  })

  it('uses the midRange formula between midRange and nearFull', () => {
    const perf = (w.perfBreakpoints.midRange + w.perfBreakpoints.nearFull) / 2
    const expected = w.midRangeBaseMult
      - (w.perfBreakpoints.nearFull - perf) * w.perfSlopes.midRange
    expect(wageMultiplier(perf)).toBeCloseTo(expected, 10)
  })

  it('drops to a punitive low-band multiplier just below midRange', () => {
    const justBelow = w.perfBreakpoints.midRange - 0.01
    // Intentional cliff: per economy.json5 comment, the low band is the
    // "near-zero pay below 50" punitive zone, distinct from the smooth
    // midRange ramp above. wageMultiplier(midRange) should pay strictly
    // more than wageMultiplier(midRange - eps).
    expect(wageMultiplier(w.perfBreakpoints.midRange))
      .toBeGreaterThan(wageMultiplier(justBelow))
  })

  it('clamps low band at 0 for non-positive perf', () => {
    expect(wageMultiplier(0)).toBe(0)
    expect(wageMultiplier(-1)).toBe(0)
    expect(wageMultiplier(-100)).toBe(0)
  })

  it('returns perf*lowSlope inside the low band', () => {
    const perf = w.perfBreakpoints.midRange / 2
    expect(wageMultiplier(perf)).toBeCloseTo(perf * w.perfSlopes.low, 10)
  })

  it('is monotonically non-decreasing across [0,100]', () => {
    let prev = wageMultiplier(0)
    for (let p = 1; p <= 100; p++) {
      const cur = wageMultiplier(p)
      expect(cur).toBeGreaterThanOrEqual(prev - 1e-12)
      prev = cur
    }
  })
})

describe('isWorkDay', () => {
  it('returns true for configured workDays only', () => {
    const s = spec({ workDays: [2, 4] })   // Tue, Thu
    const tue = new Date(2026, 0, 6)       // 2026-01-06 is a Tuesday
    const wed = new Date(2026, 0, 7)
    const thu = new Date(2026, 0, 8)
    expect(isWorkDay(tue, s)).toBe(true)
    expect(isWorkDay(wed, s)).toBe(false)
    expect(isWorkDay(thu, s)).toBe(true)
  })
})

describe('isInWorkWindow', () => {
  const s = spec({ shiftStart: 9, shiftEnd: 17, workDays: [1] }) // Mon only
  // 2026-01-05 is a Monday.
  const monAt = (h: number, m: number) => {
    const d = new Date(2026, 0, 5)
    d.setHours(h, m, 0, 0)
    return d
  }

  it('returns false on non-work days regardless of time', () => {
    const sun = new Date(2026, 0, 4)
    sun.setHours(12, 0, 0, 0)
    expect(isInWorkWindow(sun, s)).toBe(false)
  })

  it('includes the start minute (start is inclusive)', () => {
    expect(isInWorkWindow(monAt(9, 0), s)).toBe(true)
  })

  it('excludes the end minute (end is exclusive)', () => {
    expect(isInWorkWindow(monAt(17, 0), s)).toBe(false)
  })

  it('includes the last minute before the end', () => {
    expect(isInWorkWindow(monAt(16, 59), s)).toBe(true)
  })

  it('returns false strictly before the shift', () => {
    expect(isInWorkWindow(monAt(8, 59), s)).toBe(false)
    expect(isInWorkWindow(monAt(0, 0), s)).toBe(false)
  })

  it('returns false after the shift', () => {
    expect(isInWorkWindow(monAt(17, 1), s)).toBe(false)
    expect(isInWorkWindow(monAt(23, 59), s)).toBe(false)
  })
})

describe('dowLabel', () => {
  it('returns zh-CN day-of-week labels for 0..6', () => {
    expect(dowLabel(0)).toBe('周日')
    expect(dowLabel(6)).toBe('周六')
  })

  it('returns empty string for out-of-range indexes', () => {
    expect(dowLabel(-1)).toBe('')
    expect(dowLabel(7)).toBe('')
  })
})
