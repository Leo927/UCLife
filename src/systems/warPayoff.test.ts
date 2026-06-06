// planWarPayoff — the pure resolution core. Drives most-progressed selection,
// AP totalling, and unlock collection off the real ambition catalog without a
// world. The entity-applying warPayoffSystem is covered by the smoke test.

import { describe, expect, it } from 'vitest'
import { planWarPayoff } from './warPayoff'
import { getAmbition, getWarPayoffRoute } from '../character/ambitions'
import type { AmbitionSlot } from '../ecs/traits'

const slot = (id: string, currentStage: number): AmbitionSlot => ({ id, currentStage, streakAnchorMs: null })

describe('planWarPayoff', () => {
  it('returns an empty plan for no active ambitions', () => {
    const plan = planWarPayoff([])
    expect(plan.entries).toEqual([])
    expect(plan.headlineAmbitionId).toBeNull()
    expect(plan.titleZh).toBeNull()
    expect(plan.totalAp).toBe(0)
  })

  it('routes the most-progressed ambition as the headline', () => {
    // mw_pilot at stage 3, lazlos_owner at stage 0 → mw_pilot is the headline.
    const plan = planWarPayoff([slot('lazlos_owner', 0), slot('mw_pilot', 3)])
    expect(plan.headlineAmbitionId).toBe('mw_pilot')
    expect(plan.titleZh).toBe(getWarPayoffRoute(getAmbition('mw_pilot')!.warPayoff)!.titleZh)

    // Both ambitions resolve; only the headline is flagged.
    expect(plan.entries.map((e) => e.ambitionId).sort()).toEqual(['lazlos_owner', 'mw_pilot'])
    expect(plan.entries.find((e) => e.ambitionId === 'mw_pilot')!.isHeadline).toBe(true)
    expect(plan.entries.find((e) => e.ambitionId === 'lazlos_owner')!.isHeadline).toBe(false)
  })

  it('breaks ties toward the first slot', () => {
    const plan = planWarPayoff([slot('mw_pilot', 2), slot('lazlos_owner', 2)])
    expect(plan.headlineAmbitionId).toBe('mw_pilot')
  })

  it('totals AP across every resolved route', () => {
    const plan = planWarPayoff([slot('mw_pilot', 4), slot('dropout', 1)])
    const expected = (getWarPayoffRoute(getAmbition('mw_pilot')!.warPayoff)!.ap ?? 0)
      + (getWarPayoffRoute(getAmbition('dropout')!.warPayoff)!.ap ?? 0)
    expect(plan.totalAp).toBe(expected)
  })

  it('collects the headline route unlock flags', () => {
    const plan = planWarPayoff([slot('mw_pilot', 4)])
    const route = getWarPayoffRoute(getAmbition('mw_pilot')!.warPayoff)!
    expect(plan.entries[0].unlocks).toEqual(route.unlocks ?? [])
  })
})
