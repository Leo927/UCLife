import { describe, expect, it } from 'vitest'
import {
  formatUC, gameDayNumber, startDate,
  getSmoothedGameMs, setPartialMinute, useClock,
} from './clock'

describe('startDate', () => {
  it('anchors at UC 0077.04.27 09:00 local time', () => {
    const d = startDate()
    expect(d.getFullYear()).toBe(77)
    expect(d.getMonth()).toBe(3)        // April (0-indexed)
    expect(d.getDate()).toBe(27)
    expect(d.getHours()).toBe(9)
    expect(d.getMinutes()).toBe(0)
    expect(d.getSeconds()).toBe(0)
    expect(d.getMilliseconds()).toBe(0)
  })

  it('returns a fresh Date each call (callers may mutate)', () => {
    const a = startDate()
    a.setHours(0, 0, 0, 0)
    const b = startDate()
    expect(b.getHours()).toBe(9)
  })
})

describe('gameDayNumber', () => {
  it('returns 1 at the spawn instant (09:00)', () => {
    expect(gameDayNumber(startDate())).toBe(1)
  })

  it('returns 1 anywhere on the spawn day, including 00:00 and 23:59', () => {
    const dawn = startDate()
    dawn.setHours(0, 0, 0, 0)
    expect(gameDayNumber(dawn)).toBe(1)

    const dusk = startDate()
    dusk.setHours(23, 59, 59, 999)
    expect(gameDayNumber(dusk)).toBe(1)
  })

  it('rolls to day 2 at the next calendar midnight', () => {
    const next = startDate()
    next.setDate(next.getDate() + 1)
    next.setHours(0, 0, 0, 0)
    expect(gameDayNumber(next)).toBe(2)
  })

  it('returns N+1 after N full days', () => {
    for (const offset of [1, 2, 7, 30, 100]) {
      const d = startDate()
      d.setDate(d.getDate() + offset)
      expect(gameDayNumber(d)).toBe(offset + 1)
    }
  })
})

describe('getSmoothedGameMs', () => {
  it('returns plain gameDate.getTime() when partial is 0', () => {
    useClock.getState().reset()
    setPartialMinute(0)
    expect(getSmoothedGameMs()).toBe(useClock.getState().gameDate.getTime())
  })

  it('adds partial-minute fraction in milliseconds', () => {
    useClock.getState().reset()
    const base = useClock.getState().gameDate.getTime()
    setPartialMinute(0.5)
    expect(getSmoothedGameMs()).toBe(base + 30_000)
    setPartialMinute(0.25)
    expect(getSmoothedGameMs()).toBe(base + 15_000)
  })

  it('clock.reset() clears the partial-minute accumulator', () => {
    setPartialMinute(0.7)
    useClock.getState().reset()
    const base = useClock.getState().gameDate.getTime()
    expect(getSmoothedGameMs()).toBe(base)
  })
})

describe('formatUC', () => {
  it('formats the spawn date as zero-padded zh-CN string', () => {
    const out = formatUC(startDate())
    expect(out).toContain('UC 0077.04.27')
    expect(out).toContain('09:00')
  })

  it('zero-pads single-digit fields', () => {
    const d = new Date()
    d.setFullYear(80, 0, 5)             // UC 0080.01.05
    d.setHours(3, 7, 0, 0)
    const out = formatUC(d)
    expect(out).toContain('UC 0080.01.05')
    expect(out).toContain('03:07')
  })

  it('uses a zh-CN day-of-week token', () => {
    const out = formatUC(startDate())
    expect(out).toMatch(/周[日一二三四五六]/)
  })
})
