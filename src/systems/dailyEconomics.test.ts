// Phase 5.5.2 daily-economics rollover tests. Pure-koota — no clock, no
// loop, no save/load harness. Each test seeds a world with one or more
// Buildings + Owner + Facility, optionally sets `revenueAcc`/
// `salariesAcc` directly, then drives `dailyEconomicsSystem` for the
// asserted day numbers.

import { describe, expect, it, beforeEach } from 'vitest'
import { createWorld } from 'koota'
import {
  Building, Owner, Facility, Faction, EntityKey, Money, Character, IsPlayer,
} from '../ecs/traits'
import { bootstrapFactions, findFactionEntity } from '../ecs/ownership'
import {
  dailyEconomicsSystem, resetDailyEconomics,
} from './dailyEconomics'
import { economicsConfig, worldConfig } from '../config'

const TILE = worldConfig.tilePx

function spawnFacility(
  world: ReturnType<typeof createWorld>,
  typeId: string,
  key: string,
  ownerEnt: ReturnType<typeof createWorld>['spawn'] extends (...args: never[]) => infer R ? R : never,
  ownerKind: 'character' | 'faction' | 'state' = 'character',
) {
  return world.spawn(
    Building({ x: 100, y: 100, w: 5 * TILE, h: 4 * TILE, label: 'X', typeId }),
    Owner({ kind: ownerKind, entity: ownerKind === 'state' ? null : (ownerEnt as never) }),
    Facility({
      revenueAcc: 0, salariesAcc: 0, insolventDays: 0,
      lastRolloverDay: 0, closedSinceDay: 0, closedReason: null,
    }),
    EntityKey({ key }),
  )
}

function setAcc(b: ReturnType<ReturnType<typeof createWorld>['spawn']>, revenue: number, salaries: number) {
  const f = b.get(Facility)!
  b.set(Facility, { ...f, revenueAcc: revenue, salariesAcc: salaries })
}

beforeEach(() => {
  // Module-local stipend dedupe map persists across tests; clear it so
  // each `dailyEconomicsSystem(world, day)` starts with no faction
  // already-paid for that day.
  resetDailyEconomics()
})

describe('dailyEconomicsSystem — solvent player owner', () => {
  it('credits net profit to player Money', () => {
    const world = createWorld()
    const player = world.spawn(IsPlayer, Money({ amount: 1000 }), Character({ name: 'P', color: '#fff', title: 'P' }), EntityKey({ key: 'p' }))
    const bar = spawnFacility(world, 'bar', 'bld-1', player)
    setAcc(bar, 200, 60)  // bar maintenance = 35 → net = 200 - 60 - 35 = 105

    const r = dailyEconomicsSystem(world, 1)
    expect(r.facilitiesProcessed).toBe(1)
    expect(r.foreclosed).toBe(0)
    expect(player.get(Money)!.amount).toBe(1000 + 105)
    const fac = bar.get(Facility)!
    expect(fac.revenueAcc).toBe(0)
    expect(fac.salariesAcc).toBe(0)
    expect(fac.insolventDays).toBe(0)
    expect(fac.lastRolloverDay).toBe(1)
  })

  it('zeroes accumulators between rollovers', () => {
    const world = createWorld()
    const player = world.spawn(IsPlayer, Money({ amount: 1000 }), Character({ name: 'P', color: '#fff', title: 'P' }), EntityKey({ key: 'p' }))
    const bar = spawnFacility(world, 'bar', 'bld-1', player)
    setAcc(bar, 200, 60)
    dailyEconomicsSystem(world, 1)
    setAcc(bar, 50, 50)  // next-day accumulators
    const m = player.get(Money)!.amount
    dailyEconomicsSystem(world, 2)
    // Net = 50 - 50 - 35 = -35; player has plenty of cash.
    expect(player.get(Money)!.amount).toBe(m - 35)
  })

  it('refuses to double-process the same gameDay', () => {
    const world = createWorld()
    const player = world.spawn(IsPlayer, Money({ amount: 1000 }), Character({ name: 'P', color: '#fff', title: 'P' }), EntityKey({ key: 'p' }))
    const bar = spawnFacility(world, 'bar', 'bld-1', player)
    setAcc(bar, 200, 0)
    dailyEconomicsSystem(world, 1)
    const after1 = player.get(Money)!.amount
    setAcc(bar, 999, 0)  // would credit again if double-processed
    dailyEconomicsSystem(world, 1)
    expect(player.get(Money)!.amount).toBe(after1)
  })
})

describe('dailyEconomicsSystem — insolvency 3-day grace', () => {
  it('day 1 increments counter without closing', () => {
    const world = createWorld()
    const player = world.spawn(IsPlayer, Money({ amount: 0 }), Character({ name: 'P', color: '#fff', title: 'P' }), EntityKey({ key: 'p' }))
    const bar = spawnFacility(world, 'bar', 'bld-1', player)
    setAcc(bar, 0, 100)  // pure salary — net = -135, can't pay
    dailyEconomicsSystem(world, 1)
    const fac = bar.get(Facility)!
    expect(fac.insolventDays).toBe(1)
    expect(fac.closedSinceDay).toBe(0)
    expect(bar.get(Owner)!.kind).toBe('character')  // not foreclosed
    expect(player.get(Money)!.amount).toBe(0)  // unbilled deficit evaporates
  })

  it('day 2 closes the facility', () => {
    const world = createWorld()
    const player = world.spawn(IsPlayer, Money({ amount: 0 }), Character({ name: 'P', color: '#fff', title: 'P' }), EntityKey({ key: 'p' }))
    const bar = spawnFacility(world, 'bar', 'bld-1', player)
    setAcc(bar, 0, 100)
    dailyEconomicsSystem(world, 1)
    setAcc(bar, 0, 100)  // still nothing — workers showed up day 2 (the
                         // close flag isn't read until the next shift)
    dailyEconomicsSystem(world, 2)
    const fac = bar.get(Facility)!
    expect(fac.insolventDays).toBe(2)
    expect(fac.closedSinceDay).toBe(2)
    expect(fac.closedReason).toBe('insolvent')
  })

  it('day 3 reverts ownership to state', () => {
    const world = createWorld()
    const player = world.spawn(IsPlayer, Money({ amount: 0 }), Character({ name: 'P', color: '#fff', title: 'P' }), EntityKey({ key: 'p' }))
    const bar = spawnFacility(world, 'bar', 'bld-1', player)
    setAcc(bar, 0, 100)
    dailyEconomicsSystem(world, 1)
    setAcc(bar, 0, 100)
    dailyEconomicsSystem(world, 2)
    setAcc(bar, 0, 100)
    const r = dailyEconomicsSystem(world, 3)
    expect(r.foreclosed).toBe(1)
    expect(bar.get(Owner)!.kind).toBe('state')
    expect(bar.get(Owner)!.entity).toBeNull()
    const fac = bar.get(Facility)!
    expect(fac.insolventDays).toBe(0)  // reset on foreclosure
    expect(fac.closedSinceDay).toBe(0)
  })

  it('a solvent day resets the insolvency counter', () => {
    const world = createWorld()
    const player = world.spawn(IsPlayer, Money({ amount: 0 }), Character({ name: 'P', color: '#fff', title: 'P' }), EntityKey({ key: 'p' }))
    const bar = spawnFacility(world, 'bar', 'bld-1', player)
    setAcc(bar, 0, 100)
    dailyEconomicsSystem(world, 1)  // can't pay — insolvent day 1
    expect(bar.get(Facility)!.insolventDays).toBe(1)

    setAcc(bar, 200, 0)  // strong day — net = 200 - 0 - 35 = 165
    dailyEconomicsSystem(world, 2)
    const fac = bar.get(Facility)!
    expect(fac.insolventDays).toBe(0)
    expect(fac.closedSinceDay).toBe(0)
    expect(fac.closedReason).toBeNull()
  })
})

describe('dailyEconomicsSystem — owner kinds', () => {
  it('skips state-owned facilities entirely', () => {
    const world = createWorld()
    const bar = world.spawn(
      Building({ x: 100, y: 100, w: 5 * TILE, h: 4 * TILE, label: 'X', typeId: 'bar' }),
      Owner({ kind: 'state', entity: null }),
      Facility({
        revenueAcc: 999, salariesAcc: 999, insolventDays: 0,
        lastRolloverDay: 0, closedSinceDay: 0, closedReason: null,
      }),
      EntityKey({ key: 'bld-1' }),
    )
    const r = dailyEconomicsSystem(world, 1)
    expect(r.facilitiesProcessed).toBe(0)
    // Accumulators left untouched — state owners short-circuit before
    // the reset path. (Workers were never going to land revenue here in
    // the first place; state-owned doesn't accrue.)
    expect(bar.get(Facility)!.revenueAcc).toBe(999)
  })

  it('charges faction owners against Faction.fund', () => {
    const world = createWorld()
    bootstrapFactions(world)
    const ae = findFactionEntity(world, 'anaheim')!
    ae.set(Faction, { id: 'anaheim', fund: 5000 })
    const factory = spawnFacility(world, 'factory', 'bld-1', ae, 'faction')
    setAcc(factory, 1000, 200)  // factory maintenance = 110, net = 690
    dailyEconomicsSystem(world, 1)
    // Stipend (12000) + net (690) = 17690 added on top of starting 5000.
    const fund = ae.get(Faction)!.fund
    expect(fund).toBe(5000 + economicsConfig.factions.anaheim.dailyStipend + 690)
  })

  it('faction stipend fires once per day per faction', () => {
    const world = createWorld()
    bootstrapFactions(world)
    const ae = findFactionEntity(world, 'anaheim')!
    ae.set(Faction, { id: 'anaheim', fund: 0 })
    dailyEconomicsSystem(world, 1)
    expect(ae.get(Faction)!.fund).toBe(economicsConfig.factions.anaheim.dailyStipend)
    dailyEconomicsSystem(world, 1)  // same day — no second stipend
    expect(ae.get(Faction)!.fund).toBe(economicsConfig.factions.anaheim.dailyStipend)
    dailyEconomicsSystem(world, 2)
    expect(ae.get(Faction)!.fund).toBe(2 * economicsConfig.factions.anaheim.dailyStipend)
  })
})
