// Asset-readiness barrier — `awaitAssetsReady()` resolves when every
// in-flight async asset job (portrait cache load, sprite compose, etc.)
// has drained. Replaces the smoke suite's `waitForTimeout(N)` workarounds
// which were flaky under CI load.
//
// Test surface intent:
//   1. Counter accounting (begin / end, double-end safety, snapshot).
//   2. Drain semantics — resolves immediately when count is 0 (next
//      microtask), waits for drop to 0 when count > 0.
//   3. Timeout names the still-pending labels in the rejection — saves
//      hours of "which job hung?" detective work in CI logs.

import { afterEach, describe, expect, it } from 'vitest'
import {
  __resetAssetReadinessForTests,
  awaitAssetsReady,
  beginAssetJob,
  pendingAssetJobs,
  snapshotPendingAssetLabels,
} from './readiness'

afterEach(() => __resetAssetReadinessForTests())

describe('asset readiness', () => {
  it('pendingAssetJobs() starts at 0', () => {
    expect(pendingAssetJobs()).toBe(0)
  })

  it('beginAssetJob() increments and end() decrements', () => {
    const end = beginAssetJob('portrait:fixture')
    expect(pendingAssetJobs()).toBe(1)
    end()
    expect(pendingAssetJobs()).toBe(0)
  })

  it('end() is idempotent — calling twice does not double-decrement', () => {
    const e1 = beginAssetJob('sprite:fixture')
    const e2 = beginAssetJob('sprite:fixture-2')
    expect(pendingAssetJobs()).toBe(2)
    e1()
    e1()
    e1()
    expect(pendingAssetJobs()).toBe(1)
    e2()
    expect(pendingAssetJobs()).toBe(0)
  })

  it('awaitAssetsReady() resolves on next microtask when count is 0', async () => {
    let resolved = false
    const p = awaitAssetsReady().then(() => { resolved = true })
    expect(resolved).toBe(false)
    await p
    expect(resolved).toBe(true)
  })

  it('awaitAssetsReady() waits while count > 0 and resolves once it drops', async () => {
    const end = beginAssetJob('portrait:slow')
    let resolved = false
    const p = awaitAssetsReady().then(() => { resolved = true })
    await Promise.resolve()
    await Promise.resolve()
    expect(resolved).toBe(false)
    end()
    await p
    expect(resolved).toBe(true)
    expect(pendingAssetJobs()).toBe(0)
  })

  it('awaitAssetsReady() resolves all pending awaiters when count drops', async () => {
    const end = beginAssetJob('portrait:multi')
    const flags: boolean[] = [false, false, false]
    const ps = [0, 1, 2].map((i) => awaitAssetsReady().then(() => { flags[i] = true }))
    await Promise.resolve()
    expect(flags).toEqual([false, false, false])
    end()
    await Promise.all(ps)
    expect(flags).toEqual([true, true, true])
  })

  it('snapshotPendingAssetLabels() lists in-flight job labels', () => {
    expect(snapshotPendingAssetLabels()).toEqual([])
    const e1 = beginAssetJob('portrait:char-42')
    const e2 = beginAssetJob('sprite:lpc:amuro')
    expect(snapshotPendingAssetLabels().sort()).toEqual(['portrait:char-42', 'sprite:lpc:amuro'])
    e1()
    expect(snapshotPendingAssetLabels()).toEqual(['sprite:lpc:amuro'])
    e2()
    expect(snapshotPendingAssetLabels()).toEqual([])
  })

  it('omits the label when none is provided', () => {
    const end = beginAssetJob()
    expect(snapshotPendingAssetLabels()).toEqual(['<unlabeled>'])
    end()
  })

  it('rejects with the still-pending labels when the timeout fires', async () => {
    beginAssetJob('portrait:never-ends')
    beginAssetJob('sprite:also-stuck')
    await expect(awaitAssetsReady({ timeoutMs: 50 })).rejects.toThrow(
      /awaitAssetsReady.*timed out.*portrait:never-ends.*sprite:also-stuck/s,
    )
  })

  it('still rejects with the count when every pending job is unlabeled', async () => {
    beginAssetJob()
    await expect(awaitAssetsReady({ timeoutMs: 30 })).rejects.toThrow(/<unlabeled>/)
  })
})
