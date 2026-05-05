import { describe, expect, it } from 'vitest'
import { createWorld } from 'koota'
import { Character } from '../ecs/traits'
import { resetNpcBuckets, __primeTreeCacheForTest, __getCachedTreeSizeForTest } from './npc'

describe('resetNpcBuckets', () => {
  it('clears the per-entity BT cache so destroyed entities do not leak (and koota id reuse cannot inherit a stale tree)', () => {
    const world = createWorld()
    const a = world.spawn(Character({ name: 'a', color: '#fff', title: '' }))
    const b = world.spawn(Character({ name: 'b', color: '#fff', title: '' }))
    __primeTreeCacheForTest(world, a)
    __primeTreeCacheForTest(world, b)
    expect(__getCachedTreeSizeForTest(world)).toBe(2)

    resetNpcBuckets(world)

    expect(__getCachedTreeSizeForTest(world)).toBe(0)
  })

  it('per-world isolation — resetting one world does not clear another world cache', () => {
    // Regression guard: the BT cache used to live at module scope, so
    // resetNpcBuckets() in any world wiped every world. The per-world
    // singleton fix scopes the cache to the world handed in.
    const w1 = createWorld()
    const w2 = createWorld()
    const a = w1.spawn(Character({ name: 'a', color: '#fff', title: '' }))
    const b = w2.spawn(Character({ name: 'b', color: '#fff', title: '' }))
    __primeTreeCacheForTest(w1, a)
    __primeTreeCacheForTest(w2, b)
    expect(__getCachedTreeSizeForTest(w1)).toBe(1)
    expect(__getCachedTreeSizeForTest(w2)).toBe(1)

    resetNpcBuckets(w1)

    expect(__getCachedTreeSizeForTest(w1)).toBe(0)
    expect(__getCachedTreeSizeForTest(w2)).toBe(1)
  })
})
