import { describe, expect, it } from 'vitest'
import { resetNpcBuckets, __primeTreeCacheForTest, __getCachedTreeSizeForTest } from './npc'

describe('resetNpcBuckets', () => {
  it('clears the per-entity BT cache so destroyed entities do not leak (and koota id reuse cannot inherit a stale tree)', () => {
    // Synthetic entity stand-in. The cache is keyed by reference identity, so
    // any object suffices for this leak test — we don't need a real koota world.
    const fakeEntityA = { id: () => 1 } as unknown as Parameters<typeof __primeTreeCacheForTest>[0]
    const fakeEntityB = { id: () => 2 } as unknown as Parameters<typeof __primeTreeCacheForTest>[0]
    __primeTreeCacheForTest(fakeEntityA)
    __primeTreeCacheForTest(fakeEntityB)
    expect(__getCachedTreeSizeForTest()).toBe(2)

    resetNpcBuckets()

    expect(__getCachedTreeSizeForTest()).toBe(0)
  })
})
