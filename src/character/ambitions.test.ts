// Ambitions catalog loader — validates the warPayoff-route binding and the
// wartime-ambition gating shipped in Phase 7.0.D. The peacetime schema is
// already exercised indirectly by the ambitions system tests; this file pins
// the 7.0.D additions.

import { describe, expect, it } from 'vitest'
import {
  ambitions, getWarPayoffRoute, availableAmbitions, wartimeAmbitionIds,
} from './ambitions'

describe('warPayoff routes', () => {
  it('every ambition resolves to a defined route', () => {
    for (const a of ambitions) {
      expect(getWarPayoffRoute(a.warPayoff), `${a.id} → ${a.warPayoff}`).toBeDefined()
    }
  })

  it('routes carry a title + log', () => {
    for (const a of ambitions) {
      const route = getWarPayoffRoute(a.warPayoff)!
      expect(route.titleZh.length).toBeGreaterThan(0)
      expect(route.logZh.length).toBeGreaterThan(0)
    }
  })
})

describe('wartime ambition gating', () => {
  it('declares at least one wartime ambition', () => {
    expect(wartimeAmbitionIds().length).toBeGreaterThan(0)
  })

  it('hides wartime ambitions from the picker pre-war', () => {
    const preWar = availableAmbitions(false)
    for (const id of wartimeAmbitionIds()) {
      expect(preWar.some((a) => a.id === id), `${id} hidden pre-war`).toBe(false)
    }
    // Peacetime ambitions are still offered.
    expect(preWar.some((a) => a.id === 'mw_pilot')).toBe(true)
  })

  it('reveals wartime ambitions once unlocked', () => {
    const wartime = availableAmbitions(true)
    for (const id of wartimeAmbitionIds()) {
      expect(wartime.some((a) => a.id === id), `${id} shown in wartime`).toBe(true)
    }
    expect(wartime.length).toBe(ambitions.length)
  })
})
