import { describe, expect, it } from 'vitest'
import { createWorld } from 'koota'
import {
  Building, Owner, EntityKey, Character, Money, IsPlayer, Position, Knows,
} from '../ecs/traits'
import {
  bootstrapFactions, seedPrivateOwners, findFactionEntity,
} from '../ecs/ownership'
import {
  gatherListings, listedPriceFor, privateAskingPrice,
  buyFromState, buyFromOwner,
} from './realtor'
import { worldConfig, realtyConfig } from '../config'

const TILE = worldConfig.tilePx

function spawnBldg(world: ReturnType<typeof createWorld>, typeId: string, key: string, label: string, w = 5, h = 4) {
  return world.spawn(
    Building({ x: 100, y: 100, w: w * TILE, h: h * TILE, label, typeId }),
    Owner({ kind: 'state', entity: null }),
    EntityKey({ key }),
  )
}

function spawnSeller(world: ReturnType<typeof createWorld>, name: string, key: string, money = 100) {
  return world.spawn(
    Character({ name, color: '#fff', title: '市民' }),
    Money({ amount: money }),
    Position({ x: 200, y: 200 }),
    EntityKey({ key }),
  )
}

describe('listedPriceFor', () => {
  it('returns null for non-buyable types', () => {
    expect(listedPriceFor('park', { w: 10 * TILE, h: 8 * TILE })).toBeNull()
    expect(listedPriceFor('apartment', { w: 10 * TILE, h: 8 * TILE })).toBeNull()
    expect(listedPriceFor('aeComplex', { w: 28 * TILE, h: 26 * TILE })).toBeNull()
  })

  it('returns a positive price for buyable types', () => {
    const p = listedPriceFor('bar', { w: 6 * TILE, h: 4 * TILE })
    expect(p).not.toBeNull()
    expect(p!).toBeGreaterThan(0)
  })

  it('scales price with footprint', () => {
    const small = listedPriceFor('factory', { w: 8 * TILE, h: 8 * TILE })!
    const big = listedPriceFor('factory', { w: 12 * TILE, h: 12 * TILE })!
    expect(big).toBeGreaterThan(small)
  })

  it('applies the state-listing multiplier', () => {
    const p = listedPriceFor('bar', { w: 5 * TILE, h: 3 * TILE })!
    const expected = Math.round(realtyConfig.types.bar.buildingPriceTilesMul! * 5 * 3 * realtyConfig.listingMul.state)
    expect(p).toBe(expected)
  })
})

describe('gatherListings', () => {
  it('emits a listing per ownable building, sorted by category then label', () => {
    const world = createWorld()
    spawnBldg(world, 'bar', 'bld-a', '酒吧 A')
    spawnBldg(world, 'factory', 'bld-b', '工厂 B', 10, 10)
    spawnBldg(world, 'apartment', 'bld-c', '公寓 C', 10, 6)
    const listings = gatherListings(world)
    // residential first (apartment), then commercial. Within commercial,
    // localeCompare orders Chinese labels by Unicode codepoint.
    expect(listings[0].category).toBe('residential')
    expect(listings[1].category).toBe('commercial')
    expect(listings[2].category).toBe('commercial')
    const commercialTypes = new Set([listings[1].typeId, listings[2].typeId])
    expect(commercialTypes).toEqual(new Set(['bar', 'factory']))
  })

  it('skips faction-owned buildings', () => {
    const world = createWorld()
    bootstrapFactions(world)
    const ae = findFactionEntity(world, 'anaheim')!
    const ent = spawnBldg(world, 'bar', 'bld-1', '酒吧')
    ent.set(Owner, { kind: 'faction', entity: ae })
    const listings = gatherListings(world)
    expect(listings).toHaveLength(0)
  })

  it('skips hidden types like aeComplex', () => {
    const world = createWorld()
    spawnBldg(world, 'aeComplex', 'bld-x', 'AE 总部')
    const listings = gatherListings(world)
    expect(listings).toHaveLength(0)
  })

  it('attaches seller name when ownerKind is character', () => {
    const world = createWorld()
    const seller = spawnSeller(world, '陈先生', 'npc-1')
    const bld = spawnBldg(world, 'bar', 'bld-1', '酒吧')
    bld.set(Owner, { kind: 'character', entity: seller })
    const [listing] = gatherListings(world)
    expect(listing.ownerKind).toBe('character')
    expect(listing.seller?.name).toBe('陈先生')
    expect(listing.seller?.entity).toBe(seller)
  })
})

describe('seedPrivateOwners', () => {
  it('re-stamps state-owned private buildings to character ownership', () => {
    const world = createWorld()
    bootstrapFactions(world)
    spawnSeller(world, '甲', 'npc-1')
    spawnSeller(world, '乙', 'npc-2')
    spawnBldg(world, 'bar', 'bld-1', '酒吧')
    spawnBldg(world, 'factory', 'bld-2', '工厂', 8, 8)
    seedPrivateOwners(world, 'test-scene')
    for (const b of world.query(Building, Owner)) {
      const o = b.get(Owner)!
      expect(o.kind).toBe('character')
      expect(o.entity).not.toBeNull()
    }
  })

  it('leaves non-private types alone', () => {
    const world = createWorld()
    bootstrapFactions(world)
    spawnSeller(world, '甲', 'npc-1')
    spawnBldg(world, 'park', 'bld-1', '公园')   // civic, not private
    seedPrivateOwners(world, 'test-scene')
    for (const b of world.query(Building, Owner)) {
      const o = b.get(Owner)!
      expect(o.kind).toBe('state')
    }
  })

  it('is deterministic given the same seed', () => {
    const setupA = () => {
      const w = createWorld()
      bootstrapFactions(w)
      spawnSeller(w, '甲', 'npc-1')
      spawnSeller(w, '乙', 'npc-2')
      spawnSeller(w, '丙', 'npc-3')
      const b1 = spawnBldg(w, 'bar', 'bld-1', '酒吧 1')
      const b2 = spawnBldg(w, 'bar', 'bld-2', '酒吧 2')
      seedPrivateOwners(w, 'fixed-seed')
      return [b1.get(Owner)!.entity!.get(Character)!.name, b2.get(Owner)!.entity!.get(Character)!.name]
    }
    const a = setupA()
    const b = setupA()
    expect(a).toEqual(b)
  })
})

describe('buyFromState', () => {
  it('debits player wallet and transfers ownership', () => {
    const world = createWorld()
    const player = world.spawn(IsPlayer, Money({ amount: 100_000 }), EntityKey({ key: 'player' }))
    const bld = spawnBldg(world, 'bar', 'bld-1', '酒吧', 5, 3)
    const [listing] = gatherListings(world)
    const paid = buyFromState(player, listing)
    expect(paid).not.toBeNull()
    expect(player.get(Money)!.amount).toBe(100_000 - paid!)
    expect(bld.get(Owner)!.kind).toBe('character')
    expect(bld.get(Owner)!.entity).toBe(player)
  })

  it('refuses on insufficient funds', () => {
    const world = createWorld()
    const player = world.spawn(IsPlayer, Money({ amount: 5 }), EntityKey({ key: 'player' }))
    spawnBldg(world, 'factory', 'bld-1', '工厂', 10, 10)
    const [listing] = gatherListings(world)
    const paid = buyFromState(player, listing)
    expect(paid).toBeNull()
    expect(player.get(Money)!.amount).toBe(5)
  })
})

describe('privateAskingPrice', () => {
  it('drops the price as opinion rises (high opinion → discount)', () => {
    const world = createWorld()
    const player = world.spawn(IsPlayer, Money({ amount: 0 }), EntityKey({ key: 'player' }))
    const seller = spawnSeller(world, '甲', 'npc-1')

    if (!seller.has(Knows(player))) seller.add(Knows(player))
    seller.set(Knows(player), { opinion: 50, familiarity: 0, lastSeenMs: 0, meetCount: 0 })
    const friendly = privateAskingPrice(player, seller, 'bar', { w: 5 * TILE, h: 3 * TILE })!
    seller.set(Knows(player), { opinion: -50, familiarity: 0, lastSeenMs: 0, meetCount: 0 })
    const hostile = privateAskingPrice(player, seller, 'bar', { w: 5 * TILE, h: 3 * TILE })!
    expect(friendly).toBeLessThan(hostile)
  })

  it('returns null for non-buyable types', () => {
    const world = createWorld()
    const player = world.spawn(IsPlayer, Money({ amount: 0 }), EntityKey({ key: 'player' }))
    const seller = spawnSeller(world, '甲', 'npc-1')
    expect(privateAskingPrice(player, seller, 'park', { w: 10 * TILE, h: 8 * TILE })).toBeNull()
  })
})

describe('buyFromOwner', () => {
  it('transfers funds to seller and ownership to player', () => {
    const world = createWorld()
    const player = world.spawn(IsPlayer, Money({ amount: 50_000 }), EntityKey({ key: 'player' }))
    const seller = spawnSeller(world, '甲', 'npc-1', 200)
    const bld = spawnBldg(world, 'bar', 'bld-1', '酒吧')
    bld.set(Owner, { kind: 'character', entity: seller })
    const [listing] = gatherListings(world)
    const ok = buyFromOwner(player, listing, 5_000)
    expect(ok).toBe(true)
    expect(player.get(Money)!.amount).toBe(45_000)
    expect(seller.get(Money)!.amount).toBe(5_200)
    expect(bld.get(Owner)!.entity).toBe(player)
  })
})
