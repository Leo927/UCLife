import { describe, it, expect, beforeEach } from 'vitest'
import { time, getFrameStats, setFrameProfEnabled, resetFrameStats, isFrameProfEnabled } from './frameProfiler'

beforeEach(() => {
  resetFrameStats()
  setFrameProfEnabled(false)
})

describe('frameProfiler', () => {
  it('is disabled by default — time() passes through with no recording', () => {
    let called = false
    const result = time('test', () => { called = true; return 42 })
    expect(called).toBe(true)
    expect(result).toBe(42)
    // No sample recorded when disabled.
    expect(getFrameStats()['test']).toBeUndefined()
  })

  it('records samples when enabled', () => {
    setFrameProfEnabled(true)
    time('phase', () => { /* noop */ })
    time('phase', () => { /* noop */ })
    const stats = getFrameStats()
    expect(stats['phase']).toBeDefined()
    expect(stats['phase'].calls).toBe(2)
    expect(stats['phase'].mean).toBeGreaterThanOrEqual(0)
    expect(stats['phase'].max).toBeGreaterThanOrEqual(0)
    expect(stats['phase'].p99).toBeGreaterThanOrEqual(0)
  })

  it('p99 does not exceed max', () => {
    setFrameProfEnabled(true)
    for (let i = 0; i < 100; i++) time('p', () => { /* noop */ })
    const s = getFrameStats()['p']
    expect(s.p99).toBeLessThanOrEqual(s.max)
  })

  it('resetFrameStats clears all samples', () => {
    setFrameProfEnabled(true)
    time('x', () => { /* noop */ })
    resetFrameStats()
    expect(getFrameStats()['x']).toBeUndefined()
  })

  it('setFrameProfEnabled(false) clears samples', () => {
    setFrameProfEnabled(true)
    time('y', () => { /* noop */ })
    setFrameProfEnabled(false)
    expect(isFrameProfEnabled()).toBe(false)
    expect(getFrameStats()['y']).toBeUndefined()
  })

  it('returns the wrapped function result', () => {
    setFrameProfEnabled(true)
    const r = time('ret', () => 'hello')
    expect(r).toBe('hello')
  })

  it('tracks multiple distinct phases independently', () => {
    setFrameProfEnabled(true)
    time('a', () => { /* noop */ })
    time('a', () => { /* noop */ })
    time('b', () => { /* noop */ })
    const stats = getFrameStats()
    expect(stats['a'].calls).toBe(2)
    expect(stats['b'].calls).toBe(1)
  })
})
