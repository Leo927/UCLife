import { beforeEach, describe, expect, it } from 'vitest'
import {
  recordStage,
  markFrame,
  getFrameStats,
  resetFrameStats,
} from './frameProfiler'
import { frameProfConfig } from '../config/frameProf'

describe('sim/frameProfiler — per-stage frame-time aggregation', () => {
  beforeEach(() => resetFrameStats())

  it('reports count, mean, and max over recorded samples', () => {
    for (const ms of [10, 20, 30]) recordStage('sim', ms)
    const r = getFrameStats().stages.sim
    expect(r.count).toBe(3)
    expect(r.meanMs).toBeCloseTo(20)
    expect(r.maxMs).toBe(30)
  })

  it('tail percentile surfaces a bad frame the mean would average away', () => {
    // 9 small frames + 1 large: mean is pulled toward the small frames while
    // the tail reports the bad one. (Rare 1-in-N spikes outside the tail are
    // still caught by cumulative maxMs — see the eviction test below.)
    for (let i = 0; i < 9; i++) recordStage('snapshot', 5)
    recordStage('snapshot', 100)
    const r = getFrameStats().stages.snapshot
    expect(r.tailMs).toBe(100)
    expect(r.meanMs).toBeLessThan(r.tailMs)
  })

  it('flags a stage whose tail crosses the frame budget', () => {
    recordStage('pixiUpdate', frameProfConfig.budgetMs + 5)
    const r = getFrameStats().stages.pixiUpdate
    expect(r.overBudget).toBe(true)
  })

  it('keeps cumulative max but a windowed tail — an evicted spike drops out of the tail', () => {
    const W = frameProfConfig.windowSize
    recordStage('sim', 999) // early spike, will be evicted from the window
    for (let i = 0; i < W; i++) recordStage('sim', 5) // fill the window with small samples
    const r = getFrameStats().stages.sim
    expect(r.maxMs).toBe(999) // cumulative max still remembers it
    expect(r.tailMs).toBe(5) // windowed tail no longer sees it
  })

  it('markFrame records the interval between successive timestamps, seeding none on the first call', () => {
    markFrame(1000)
    expect(getFrameStats().stages.frame).toBeUndefined()
    markFrame(1016)
    markFrame(1033)
    const r = getFrameStats().stages.frame
    expect(r.count).toBe(2)
    expect(r.maxMs).toBeCloseTo(17)
  })

  it('reset clears all stages and the frame-interval anchor', () => {
    recordStage('sim', 42)
    markFrame(5000)
    resetFrameStats()
    expect(getFrameStats().stages).toEqual({})
    // After reset the next markFrame is a fresh first call → seeds no sample.
    markFrame(6000)
    expect(getFrameStats().stages.frame).toBeUndefined()
  })

  it('echoes the configured percentile and budget in the report header', () => {
    const r = getFrameStats()
    expect(r.percentile).toBe(frameProfConfig.percentile)
    expect(r.budgetMs).toBe(frameProfConfig.budgetMs)
  })
})
