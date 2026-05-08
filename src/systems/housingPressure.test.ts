import { describe, expect, it } from 'vitest'
import { createWorld } from 'koota'
import {
  Bed, Building, Character, EntityKey, Facility, IsPlayer, Job, Money,
  Owner, Position, Workstation, Knows,
} from '../ecs/traits'
import { housingPressureSystem } from './housingPressure'
import { worldConfig, economicsConfig } from '../config'

const TILE = worldConfig.tilePx
const cfg = economicsConfig.housingPressure

function spawnPlayer(world: ReturnType<typeof createWorld>) {
  return world.spawn(
    Character({ name: '玩家', color: '#fff', title: '' }),
    IsPlayer(),
    Money({ amount: 0 }),
    EntityKey({ key: 'player' }),
  )
}

function spawnMember(world: ReturnType<typeof createWorld>, key: string) {
  return world.spawn(
    Character({ name: key, color: '#fff', title: '员工' }),
    Money({ amount: 0 }),
    Job({ workstation: null, unemployedSinceMs: 0 }),
    EntityKey({ key }),
  )
}

function spawnBldg(world: ReturnType<typeof createWorld>, typeId: string, key: string, owner: ReturnType<typeof spawnPlayer>) {
  return world.spawn(
    Building({ x: 0, y: 0, w: 10 * TILE, h: 10 * TILE, label: typeId, typeId }),
    Owner({ kind: 'character', entity: owner }),
    Facility({
      revenueAcc: 0, salariesAcc: 0, insolventDays: 0,
      lastRolloverDay: 0, closedSinceDay: 0, closedReason: null,
    }),
    EntityKey({ key }),
  )
}

function spawnWs(world: ReturnType<typeof createWorld>, occupant: ReturnType<typeof spawnMember> | null, key: string) {
  return world.spawn(
    Position({ x: 1 * TILE, y: 1 * TILE }),
    Workstation({ specId: 'bartender', occupant }),
    EntityKey({ key }),
  )
}

function spawnBed(world: ReturnType<typeof createWorld>, claimedBy: ReturnType<typeof spawnMember> | null, key: string) {
  return world.spawn(
    Position({ x: 2 * TILE, y: 2 * TILE }),
    Bed({ tier: 'apartment', nightlyRent: 100, occupant: null, rentPaidUntilMs: 0, owned: false, claimedBy }),
    EntityKey({ key }),
  )
}

describe('housingPressureSystem', () => {
  it('decays opinion of unhoused members', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const m = spawnMember(world, 'm1')
    const bldg = spawnBldg(world, 'bar', 'bld-bar', player)
    void bldg
    const ws = spawnWs(world, m, 'ws-1')
    m.set(Job, { workstation: ws, unemployedSinceMs: 0 })
    // No bed claim → unhoused.
    const r = housingPressureSystem(world)
    expect(r.unhousedCount).toBe(1)
    expect(r.decayedCount).toBe(1)
    expect(m.has(Knows(player))).toBe(true)
    expect(m.get(Knows(player))!.opinion).toBe(cfg.opinionDecayPerUnhousedDay)
  })

  it('does not decay housed members', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const m = spawnMember(world, 'm1')
    const bldg = spawnBldg(world, 'apartment', 'bld-apt', player)
    void bldg
    spawnBed(world, m, 'bed-1')
    const r = housingPressureSystem(world)
    expect(r.unhousedCount).toBe(0)
    expect(r.decayedCount).toBe(0)
  })

  it('clamps decay against the configured floor', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const m = spawnMember(world, 'm1')
    const bldg = spawnBldg(world, 'bar', 'bld-bar', player)
    void bldg
    const ws = spawnWs(world, m, 'ws-1')
    m.set(Job, { workstation: ws, unemployedSinceMs: 0 })
    m.add(Knows(player))
    m.set(Knows(player), { opinion: cfg.minOpinionFromHousing, familiarity: 0, lastSeenMs: 0, meetCount: 0 })
    const r = housingPressureSystem(world)
    expect(r.unhousedCount).toBe(1)
    // Already at floor — opinion shouldn't go below.
    expect(m.get(Knows(player))!.opinion).toBe(cfg.minOpinionFromHousing)
  })

  it('no-ops without a player', () => {
    const world = createWorld()
    const r = housingPressureSystem(world)
    expect(r.unhousedCount).toBe(0)
    expect(r.decayedCount).toBe(0)
  })
})
