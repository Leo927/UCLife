import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { step } from './runtime'
import { freezeSimNow, simNow, unfreezeSimNow } from '../sim/time'
import { pinTestModeSpeed } from './clock'
import { useClock } from '../sim/clock'
import { testConfig } from './test-config'

const MS_PER_MINUTE = testConfig.msPerGameMinute

describe('step()', () => {
  beforeEach(() => {
    freezeSimNow(0)
    pinTestModeSpeed()
    // Reset zustand clock to a known epoch so per-test advance math
    // doesn't accumulate across cases.
    useClock.getState().reset()
    // pinTestModeSpeed must run AFTER reset (reset sets speed=1, which
    // is what we want, but be explicit so the test reads as deliberate).
    pinTestModeSpeed()
  })

  afterEach(() => {
    unfreezeSimNow()
  })

  it('gameMinutes form: advances simNow by exactly N * 60_000', async () => {
    const start = simNow()
    await step({ gameMinutes: 5 })
    expect(simNow() - start).toBe(5 * MS_PER_MINUTE)
  })

  it('gameMinutes form: drives sub-tick remainders cleanly', async () => {
    const start = simNow()
    await step({ gameMinutes: 1 })
    expect(simNow() - start).toBe(MS_PER_MINUTE)
  })

  it('until form: resolves on the first tick the predicate flips true', async () => {
    const flipAt = simNow() + 3 * testConfig.tickGameMs
    await step({
      until: () => simNow() >= flipAt,
      maxGameMinutes: 1,
    })
    const delta = simNow() - flipAt
    expect(delta).toBeGreaterThanOrEqual(0)
    expect(delta).toBeLessThan(testConfig.tickGameMs * 2)
  })

  it('until form: returns immediately when predicate already true', async () => {
    const start = simNow()
    await step({ until: () => true, maxGameMinutes: 1 })
    expect(simNow()).toBe(start)
  })

  it('until form: throws after maxGameMinutes with predicate text in message', async () => {
    const predicate = () => false
    let err: Error | null = null
    try {
      await step({ until: predicate, maxGameMinutes: 1 })
    } catch (e) {
      err = e as Error
    }
    expect(err).not.toBeNull()
    expect(err!.message).toContain('predicate never satisfied')
    expect(err!.message).toContain('1 game-minute')
    // Predicate text snippet included for debuggability.
    expect(err!.message).toContain('()')
  })

  it('until form: bounded by maxGameMinutes; does not loop forever', async () => {
    const start = simNow()
    let caught: Error | null = null
    try {
      await step({ until: () => false, maxGameMinutes: 1 })
    } catch (e) {
      caught = e as Error
    }
    expect(caught).not.toBeNull()
    expect(simNow() - start).toBeGreaterThanOrEqual(MS_PER_MINUTE)
    expect(simNow() - start).toBeLessThan(2 * MS_PER_MINUTE)
  })
})
