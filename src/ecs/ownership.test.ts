import { describe, expect, it } from 'vitest'
import { createWorld } from 'koota'
import { Faction, Owner, EntityKey } from './traits'
import {
  bootstrapFactions, defaultOwnerFor, factionKey, findFactionEntity,
} from './ownership'
import { factionsConfig } from '../config'

describe('bootstrapFactions', () => {
  it('spawns one Faction entity per FactionId in the catalog', () => {
    const world = createWorld()
    bootstrapFactions(world)
    const ids: string[] = []
    for (const e of world.query(Faction)) {
      ids.push(e.get(Faction)!.id)
    }
    const expected = Object.keys(factionsConfig.catalog).sort()
    expect(ids.sort()).toEqual(expected)
  })

  it('tags each Faction entity with a stable EntityKey for save round-trip', () => {
    const world = createWorld()
    bootstrapFactions(world)
    for (const e of world.query(Faction)) {
      const key = e.get(EntityKey)?.key
      const factionId = e.get(Faction)!.id
      expect(key).toBe(factionKey(factionId))
    }
  })

  it('is idempotent — calling twice does not duplicate entities', () => {
    const world = createWorld()
    bootstrapFactions(world)
    bootstrapFactions(world)
    let count = 0
    for (const _ of world.query(Faction)) count++
    expect(count).toBe(Object.keys(factionsConfig.catalog).length)
  })

  it('initializes fund to zero', () => {
    const world = createWorld()
    bootstrapFactions(world)
    for (const e of world.query(Faction)) {
      expect(e.get(Faction)!.fund).toBe(0)
    }
  })
})

describe('findFactionEntity', () => {
  it('returns the entity for a bootstrapped faction', () => {
    const world = createWorld()
    bootstrapFactions(world)
    const ae = findFactionEntity(world, 'anaheim')
    expect(ae).not.toBeNull()
    expect(ae!.get(Faction)!.id).toBe('anaheim')
  })

  it('returns null when the faction was never bootstrapped', () => {
    const world = createWorld()
    expect(findFactionEntity(world, 'anaheim')).toBeNull()
  })
})

describe('defaultOwnerFor', () => {
  it('returns state ownership for civic types', () => {
    const world = createWorld()
    bootstrapFactions(world)
    const owner = defaultOwnerFor(world, 'park')
    expect(owner.kind).toBe('state')
    expect(owner.entity).toBeNull()
  })

  it('returns faction ownership pointing at the canonical Faction entity for AE complex', () => {
    const world = createWorld()
    bootstrapFactions(world)
    const owner = defaultOwnerFor(world, 'aeComplex')
    expect(owner.kind).toBe('faction')
    const factionEntity = owner.entity!
    expect(factionEntity.get(Faction)!.id).toBe('anaheim')
  })

  it('falls back to state ownership for an unknown building type', () => {
    const world = createWorld()
    bootstrapFactions(world)
    const owner = defaultOwnerFor(world, 'unknown_building_type')
    expect(owner.kind).toBe('state')
    expect(owner.entity).toBeNull()
  })

  it('falls back to state ownership when the canonical faction was not bootstrapped', () => {
    // Simulates a test setup that skipped bootstrapFactions — the building
    // still gets an Owner instead of holding a dangling ref.
    const world = createWorld()
    const owner = defaultOwnerFor(world, 'aeComplex')
    expect(owner.kind).toBe('state')
    expect(owner.entity).toBeNull()
  })
})

describe('Owner trait shape', () => {
  it('attaches to an entity carrying state ownership', () => {
    const world = createWorld()
    const e = world.spawn(Owner({ kind: 'state', entity: null }))
    expect(e.get(Owner)!.kind).toBe('state')
    expect(e.get(Owner)!.entity).toBeNull()
  })

  it('attaches to an entity carrying faction ownership with a live ref', () => {
    const world = createWorld()
    bootstrapFactions(world)
    const ae = findFactionEntity(world, 'anaheim')!
    const e = world.spawn(Owner({ kind: 'faction', entity: ae }))
    expect(e.get(Owner)!.kind).toBe('faction')
    expect(e.get(Owner)!.entity).toBe(ae)
  })
})
