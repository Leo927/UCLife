import { describe, it, expect } from 'vitest'
import {
  NEWS_ENTRIES, getNewsEntry, getHeadlinesForDate, topHeadlineForDate, ucDateKey,
} from './news'

describe('news content table', () => {
  it('loads entries with unique ids and well-formed dates', () => {
    expect(NEWS_ENTRIES.length).toBeGreaterThan(20)
    const ids = new Set(NEWS_ENTRIES.map((e) => e.id))
    expect(ids.size).toBe(NEWS_ENTRIES.length)
    for (const e of NEWS_ENTRIES) {
      expect(e.date).toMatch(/^UC \d{4}\.\d{2}\.\d{2}$/)
      expect(e.headlineZh.length).toBeGreaterThan(0)
    }
  })

  it('resolves an entry by id', () => {
    const e = getNewsEntry('op-british')
    expect(e).toBeDefined()
    expect(e!.tags).toContain('war')
    expect(e!.date).toBe('UC 0079.01.03')
  })

  it('returns a date\'s headlines in descending priority order', () => {
    const list = getHeadlinesForDate('UC 0077.04.28')
    expect(list.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1].priority).toBeGreaterThanOrEqual(list[i].priority)
    }
  })

  it('picks the highest-priority entry as the top headline', () => {
    const top = topHeadlineForDate('UC 0077.04.28')
    expect(top).not.toBeNull()
    expect(top!.id).toBe('vb-dome-maintenance')
  })

  it('returns null / empty for a date with no entries', () => {
    expect(topHeadlineForDate('UC 0099.12.31')).toBeNull()
    expect(getHeadlinesForDate('UC 0099.12.31')).toEqual([])
  })

  it('formats a UC date key matching the table format', () => {
    const d = new Date()
    d.setFullYear(79, 0, 3) // year 79, January (monthIndex 0), day 3
    d.setHours(14, 30, 0, 0)
    expect(ucDateKey(d)).toBe('UC 0079.01.03')
  })
})
