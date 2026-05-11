// Phase 6.2 — brig POW capture + capacity gating. The add() path is
// the load-bearing edge: notable-hostile death routes through it, and
// the brig must refuse once capacity is reached (otherwise the
// captured-panel keeps stacking names and the player is silently
// over-capacity with no diegetic cap).

import { describe, expect, it, beforeEach, vi } from 'vitest'
import { useBrig, type PrisonerRecord } from './brig'

vi.mock('../ecs/world', () => {
  // Hand-built world stub: a single Ship singleton on the
  // playerShipInterior world with brigCapacity sourced from the ship
  // class. The test seeds the singleton inside the stub so brig.add()'s
  // capacity lookup resolves without booting the full scene loader.
  return {
    getWorld: () => stubWorld,
  }
})

vi.mock('../ecs/traits', () => {
  const Ship = Symbol('Ship-stub')
  return { Ship }
})

vi.mock('../data/ships', () => {
  return {
    getShipClass: () => ({ brigCapacity: 2 }),
  }
})

// Stubbed koota world for the test — queryFirst returns the singleton
// (in this case a ship-shaped object); get(Ship) returns the class id
// the brig store uses to look up brigCapacity.
const stubShipEntity = {
  get: () => ({ classId: 'test-class' }),
}
const stubWorld = {
  queryFirst: () => stubShipEntity,
}

function recordOf(id: string): PrisonerRecord {
  return {
    id,
    nameZh: id,
    contextZh: 'test',
    factionId: 'pirate',
    capturedAtMs: 0,
  }
}

beforeEach(() => {
  useBrig.getState().reset()
})

describe('brig POW store', () => {
  it('add() admits up to brigCapacity prisoners', () => {
    expect(useBrig.getState().add(recordOf('a'))).toBe(true)
    expect(useBrig.getState().add(recordOf('b'))).toBe(true)
    expect(useBrig.getState().prisoners).toHaveLength(2)
  })

  it('refuses new captures once at capacity', () => {
    useBrig.getState().add(recordOf('a'))
    useBrig.getState().add(recordOf('b'))
    expect(useBrig.getState().add(recordOf('c'))).toBe(false)
    expect(useBrig.getState().prisoners).toHaveLength(2)
  })

  it('refuses duplicate id even with room — prisoner identity is canonical', () => {
    useBrig.getState().add(recordOf('a'))
    expect(useBrig.getState().add(recordOf('a'))).toBe(false)
    expect(useBrig.getState().prisoners).toHaveLength(1)
  })

  it('pendingTally tracks captures since last clearPendingTally', () => {
    useBrig.getState().add(recordOf('a'))
    useBrig.getState().add(recordOf('b'))
    expect(useBrig.getState().pendingTally.map((p) => p.id)).toEqual(['a', 'b'])
    useBrig.getState().clearPendingTally()
    expect(useBrig.getState().pendingTally).toEqual([])
    // Roster is unaffected by clearPendingTally — the cleared field is
    // the per-engagement queue, not the long-arc brig record.
    expect(useBrig.getState().prisoners).toHaveLength(2)
  })

  it('reset() empties both the roster and the per-engagement queue', () => {
    useBrig.getState().add(recordOf('a'))
    useBrig.getState().reset()
    expect(useBrig.getState().prisoners).toEqual([])
    expect(useBrig.getState().pendingTally).toEqual([])
  })

  it('serialize/hydrate round-trips the roster (pendingTally is per-session)', () => {
    useBrig.getState().add(recordOf('a'))
    useBrig.getState().add(recordOf('b'))
    const snap = useBrig.getState().serialize()
    useBrig.getState().reset()
    useBrig.getState().hydrate(snap)
    expect(useBrig.getState().prisoners.map((p) => p.id)).toEqual(['a', 'b'])
    expect(useBrig.getState().pendingTally).toEqual([])
  })

  it('hydrate(null) is a clean reset', () => {
    useBrig.getState().add(recordOf('a'))
    useBrig.getState().hydrate(null)
    expect(useBrig.getState().prisoners).toEqual([])
  })
})
