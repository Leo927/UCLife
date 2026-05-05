import { describe, expect, it } from 'vitest'
import { createWorld, trait } from 'koota'
import { worldSingleton, bootstrapWorldSingleton, WorldSingleton } from './resources'

describe('worldSingleton', () => {
  it('returns the same entity across calls on one world', () => {
    const world = createWorld()
    const a = worldSingleton(world)
    const b = worldSingleton(world)
    expect(a).toBe(b)
    expect(a.has(WorldSingleton)).toBe(true)
  })

  it('returns distinct entities for distinct worlds — per-world isolation', () => {
    const w1 = createWorld()
    const w2 = createWorld()
    const e1 = worldSingleton(w1)
    const e2 = worldSingleton(w2)
    expect(e1).not.toBe(e2)
  })

  it('per-world resource trait state is isolated between worlds', () => {
    // Two scenes, each with their own scheduling counter. Mutating one
    // must not leak into the other.
    const Counter = trait({ value: 0 })
    const w1 = createWorld()
    const w2 = createWorld()
    bootstrapWorldSingleton(w1)
    bootstrapWorldSingleton(w2)
    const e1 = worldSingleton(w1)
    const e2 = worldSingleton(w2)
    e1.add(Counter({ value: 7 }))
    e2.add(Counter({ value: 99 }))
    expect(e1.get(Counter)!.value).toBe(7)
    expect(e2.get(Counter)!.value).toBe(99)
  })

  it('survives world.reset() — the returned singleton has the marker, even if the cached one was destroyed', () => {
    // koota's reset destroys all entities including the singleton; the
    // helper must not return a dangling cached reference afterward.
    // (koota recycles entity ids, so we don't assert reference inequality
    // — we assert that the returned entity is alive + carries the marker.)
    const Counter = trait({ value: 0 })
    const world = createWorld()
    const before = worldSingleton(world)
    before.add(Counter({ value: 42 }))
    world.reset()
    const after = worldSingleton(world)
    expect(after.has(WorldSingleton)).toBe(true)
    // The fresh singleton must not carry stale state — Counter was on the
    // pre-reset entity; after reset it must be gone.
    expect(after.has(Counter)).toBe(false)
  })
})
