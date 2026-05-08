import { describe, expect, it } from 'vitest'
import { createWorld } from 'koota'
import { Character, Money } from '../ecs/traits'
import { makeNPCAgent } from './agent'
import { NPC_TREE } from './trees'
import { aiConfig } from '../config'

const DESTITUTE = aiConfig.livingStandards.destituteCash

describe('agent.isDestitute', () => {
  it('is true when money is at or below destituteCash and false above', () => {
    const world = createWorld()
    const ent = world.spawn(
      Character({ name: 'a', color: '#fff', title: '' }),
      Money({ amount: DESTITUTE - 1 }),
    )
    const agent = makeNPCAgent(world, ent)

    agent.refreshContext()
    expect(agent.isDestitute()).toBe(true)

    ent.set(Money, { amount: DESTITUTE })
    agent.refreshContext()
    expect(agent.isDestitute()).toBe(true)

    ent.set(Money, { amount: DESTITUTE + 1 })
    agent.refreshContext()
    expect(agent.isDestitute()).toBe(false)
  })

  it('treats a missing Money trait as destitute (newly-spawned immigrants)', () => {
    const world = createWorld()
    const ent = world.spawn(Character({ name: 'a', color: '#fff', title: '' }))
    const agent = makeNPCAgent(world, ent)
    agent.refreshContext()
    expect(agent.isDestitute()).toBe(true)
  })
})

describe('NPC_TREE — survival fallback gating', () => {
  // Structural assertions — the gating logic is data, so a regression that
  // re-orders these children would silently re-enable wealthy NPCs to sleep
  // rough / scavenge. Walking the tree and checking position is cheaper than
  // bringing up a full world to drive the BT.
  function findRoot() {
    return NPC_TREE.child as { type: string; children: unknown[] }
  }
  function find(node: unknown, pred: (n: { call?: string; type?: string }) => boolean): unknown | null {
    if (!node || typeof node !== 'object') return null
    const n = node as { type?: string; call?: string; child?: unknown; children?: unknown[] }
    if (pred(n)) return n
    if (n.child) {
      const hit = find(n.child, pred)
      if (hit) return hit
    }
    if (n.children) {
      for (const c of n.children) {
        const hit = find(c, pred)
        if (hit) return hit
      }
    }
    return null
  }

  it('eat-trash branch is gated on isDestitute', () => {
    const trashBranch = find(findRoot(), (n) => n.type === 'sequence' && Array.isArray((n as { children?: unknown[] }).children) && (n as { children: { call?: string }[] }).children.some((c) => c.call === 'goToTrash')) as { children: { call?: string }[] } | null
    expect(trashBranch).toBeTruthy()
    const calls = trashBranch!.children.map((c) => c.call)
    expect(calls[0]).toBe('isDestitute')
    expect(calls).toContain('hasTrash')
  })

  it('rough-sleep branch is the last sleep fallback (no wealth gate, runs only after findHome FAILs)', () => {
    // Rough sleep is intentionally NOT gated on isDestitute — if every
    // affordable bed is rented out, a wealthy NPC must still sleep rough
    // rather than die of fatigue saturation. The findHome branch above this
    // one is what prevents the "wealthy in the park" bug.
    const roughBranch = find(findRoot(), (n) => n.type === 'sequence' && Array.isArray((n as { children?: unknown[] }).children) && (n as { children: { call?: string }[] }).children.some((c) => c.call === 'sleepRough')) as { children: { call?: string }[] } | null
    expect(roughBranch).toBeTruthy()
    const calls = roughBranch!.children.map((c) => c.call)
    expect(calls).not.toContain('isDestitute')
    expect(calls).toContain('isHomeless')
    expect(calls).toContain('hasRoughSpot')
  })

  it('sleep selector tries findHome before falling to rough sleep', () => {
    // Find the selector that contains both a sleep+goHome sequence and a
    // sleepRough sequence.
    const sleepSelector = find(findRoot(), (n) => {
      if (n.type !== 'selector') return false
      const c = (n as { children?: { children?: { call?: string }[] }[] }).children
      if (!c) return false
      return c.some((seq) => seq.children?.some((s) => s.call === 'sleep'))
        && c.some((seq) => seq.children?.some((s) => s.call === 'sleepRough'))
    }) as { children: { children: { call?: string }[] }[] } | null
    expect(sleepSelector).toBeTruthy()

    const idxFindHome = sleepSelector!.children.findIndex((seq) => seq.children?.some((s) => s.call === 'findHome'))
    const idxRough = sleepSelector!.children.findIndex((seq) => seq.children?.some((s) => s.call === 'sleepRough'))
    expect(idxFindHome).toBeGreaterThanOrEqual(0)
    expect(idxRough).toBeGreaterThanOrEqual(0)
    expect(idxFindHome).toBeLessThan(idxRough)
  })
})
