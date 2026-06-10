// Phase 5.5.6 facility-tier infrastructure (issue #141). Unit tests for
// the upgrade state machine: gate states, credit + downtime flow, seat
// spawn on completion, defaults, and the save round-trip. Drives a koota
// createWorld() like the research/relations test suites.

import { afterEach, describe, expect, it } from 'vitest'
import { createWorld } from 'koota'
import {
  Action, Building, Character, EntityKey, Faction, FactionResearch,
  FactionSheet, FactionEffectsList, FactionUnlocks, FacilityTiers, Facility,
  IsPlayer, Job, JobPerformance, Money, Owner, Position, Workstation,
} from '../ecs/traits'
import { createFactionSheet } from '../stats/factionSchema'
import { addFactionUnlock } from '../ecs/factionEffects'
import {
  facilityEfficiencyMul, facilityTierDowntimeSystem, isFacilityInDowntime,
  restoreFacilityTiers, snapshotFacilityTiers, startTierUpgrade, tierPanelView,
} from './facilityTiers'
import { facilityTierLadder } from '../data/facilityTypes'
import { getObjectTemplate } from '../data/objectTemplates'
import { worldConfig } from '../config'
import { workSystem } from './work'
import { researchSystem, enqueueResearch } from './research'

const TILE = worldConfig.tilePx
const FACTORY_T2_UNLOCK = 'upgrade:factory-tier-2'

const createdWorlds: ReturnType<typeof createWorld>[] = []
afterEach(() => {
  while (createdWorlds.length) createdWorlds.pop()!.destroy()
})

function makeWorld() {
  const world = createWorld()
  createdWorlds.push(world)
  const civ = world.spawn(
    Faction({ id: 'civilian', fund: 0 }),
    EntityKey({ key: 'faction-civilian' }),
    FactionSheet({ sheet: createFactionSheet() }),
    FactionEffectsList({ list: [] }),
    FactionUnlocks({ ids: [] }),
  )
  const player = world.spawn(
    Character({ name: '玩家', color: '#fff', title: '' }),
    IsPlayer(),
    Money({ amount: 20000 }),
    EntityKey({ key: 'player' }),
  )
  return { world, civ, player }
}

function spawnFactory(
  world: ReturnType<typeof createWorld>,
  player: ReturnType<ReturnType<typeof createWorld>['spawn']>,
) {
  const factory = world.spawn(
    Building({ x: 0, y: 0, w: 10 * TILE, h: 12 * TILE, label: '工厂', typeId: 'factory' }),
    Owner({ kind: 'character', entity: player }),
    Facility({
      revenueAcc: 0, salariesAcc: 0, insolventDays: 0,
      lastRolloverDay: 0, closedSinceDay: 0, closedReason: null,
    }),
    EntityKey({ key: 'bld-factory' }),
  )
  // Two baseline worker seats inside the floor so runtime seat placement
  // has neighbors to anchor on.
  world.spawn(
    Position({ x: 4 * TILE, y: 6 * TILE }),
    Workstation({ specId: 'factory_worker_day', occupant: null }),
    EntityKey({ key: 'ws-base-1' }),
  )
  world.spawn(
    Position({ x: 6 * TILE, y: 8 * TILE }),
    Workstation({ specId: 'factory_worker_morning', occupant: null }),
    EntityKey({ key: 'ws-base-2' }),
  )
  return factory
}

function factoryStationCount(world: ReturnType<typeof createWorld>): number {
  let n = 0
  for (const ws of world.query(Workstation, Position)) {
    const spec = ws.get(Workstation)!.specId
    if (spec.startsWith('factory_worker')) n += 1
  }
  return n
}

describe('facility tier ladder data', () => {
  it('authors the factory job-site ladder gated on the research unlock', () => {
    const ladder = facilityTierLadder('factory')!
    expect(ladder, 'factory must have a tier ladder').not.toBeNull()
    const t2 = ladder.jobSiteCount.find((r) => r.tier === 2)!
    expect(t2, 'factory jobSiteCount needs a tier-2 row').toBeDefined()
    expect(t2.requiresUnlock).toBe(FACTORY_T2_UNLOCK)
    expect(t2.creditCost).toBeGreaterThan(0)
    expect(t2.downtimeDays).toBeGreaterThan(0)
    for (const id of t2.addStations!) {
      const tpl = getObjectTemplate(id as Parameters<typeof getObjectTemplate>[0])
      expect(tpl.kind, `${id} must be a workstation template`).toBe('workstation')
    }
  })
})

describe('tierPanelView gate states', () => {
  it('shows tier-1 done and tier-2 visible-but-locked with gate text before the unlock', () => {
    const { world, player } = makeWorld()
    const factory = spawnFactory(world, player)
    const rows = tierPanelView(world, factory)
    const t1 = rows.find((r) => r.knob === 'jobSiteCount' && r.tier === 1)!
    const t2 = rows.find((r) => r.knob === 'jobSiteCount' && r.tier === 2)!
    expect(t1.state).toBe('done')
    expect(t2.state, 'locked rows must stay visible, never hidden').toBe('locked')
    expect(t2.gateTextZh, 'gate text must name the gating research').toContain('工厂扩容')
  })

  it('flips tier-2 locked → available once the faction unlock lands', () => {
    const { world, civ, player } = makeWorld()
    const factory = spawnFactory(world, player)
    addFactionUnlock(civ, FACTORY_T2_UNLOCK)
    const t2 = tierPanelView(world, factory)
      .find((r) => r.knob === 'jobSiteCount' && r.tier === 2)!
    expect(t2.state).toBe('available')
    expect(t2.creditCost).toBeGreaterThan(0)
  })
})

describe('startTierUpgrade', () => {
  it('refuses while the unlock is missing', () => {
    const { world, player } = makeWorld()
    const factory = spawnFactory(world, player)
    const res = startTierUpgrade(world, factory, 'jobSiteCount', 2)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('locked')
  })

  it('refuses when the owner cannot pay', () => {
    const { world, civ, player } = makeWorld()
    const factory = spawnFactory(world, player)
    addFactionUnlock(civ, FACTORY_T2_UNLOCK)
    player.set(Money, { amount: 1 })
    const res = startTierUpgrade(world, factory, 'jobSiteCount', 2)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('fund')
  })

  it('deducts the credit cost and starts downtime', () => {
    const { world, civ, player } = makeWorld()
    const factory = spawnFactory(world, player)
    addFactionUnlock(civ, FACTORY_T2_UNLOCK)
    const cost = facilityTierLadder('factory')!.jobSiteCount[1].creditCost!
    const before = player.get(Money)!.amount

    const res = startTierUpgrade(world, factory, 'jobSiteCount', 2)
    expect(res.ok, `startTierUpgrade failed: ${res.reason}`).toBe(true)
    expect(player.get(Money)!.amount).toBe(before - cost)
    const tiers = factory.get(FacilityTiers)!
    expect(tiers.upgrade).toEqual({
      knob: 'jobSiteCount', toTier: 2,
      daysRemaining: facilityTierLadder('factory')!.jobSiteCount[1].downtimeDays,
    })
    expect(isFacilityInDowntime(factory)).toBe(true)
  })

  it('refuses a second concurrent upgrade', () => {
    const { world, civ, player } = makeWorld()
    const factory = spawnFactory(world, player)
    addFactionUnlock(civ, FACTORY_T2_UNLOCK)
    expect(startTierUpgrade(world, factory, 'jobSiteCount', 2).ok).toBe(true)
    const res = startTierUpgrade(world, factory, 'jobSiteCount', 2)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('busy')
  })

  it('refuses a tier with no authored row', () => {
    const { world, civ, player } = makeWorld()
    const factory = spawnFactory(world, player)
    addFactionUnlock(civ, FACTORY_T2_UNLOCK)
    const res = startTierUpgrade(world, factory, 'jobSiteCount', 3)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('no-row')
  })
})

describe('facilityTierDowntimeSystem', () => {
  it('counts the downtime down, then applies the tier and spawns the new seats', () => {
    const { world, civ, player } = makeWorld()
    const factory = spawnFactory(world, player)
    addFactionUnlock(civ, FACTORY_T2_UNLOCK)
    const row = facilityTierLadder('factory')!.jobSiteCount[1]
    const seatsBefore = factoryStationCount(world)
    startTierUpgrade(world, factory, 'jobSiteCount', 2)

    for (let day = 1; day < row.downtimeDays!; day++) {
      facilityTierDowntimeSystem(world)
      expect(isFacilityInDowntime(factory), `still in downtime after day ${day}`).toBe(true)
      expect(factoryStationCount(world)).toBe(seatsBefore)
    }
    const result = facilityTierDowntimeSystem(world)
    expect(result.applied).toContain('bld-factory')
    const tiers = factory.get(FacilityTiers)!
    expect(tiers.jobSiteCount).toBe(2)
    expect(tiers.upgrade).toBeNull()
    expect(isFacilityInDowntime(factory)).toBe(false)
    expect(factoryStationCount(world), 'tier-2 must add its authored seats')
      .toBe(seatsBefore + row.addStations!.length)

    // New seats land on free tiles inside the building rect.
    const bld = factory.get(Building)!
    for (const ws of world.query(Workstation, Position)) {
      const p = ws.get(Position)!
      expect(p.x).toBeGreaterThanOrEqual(bld.x)
      expect(p.x).toBeLessThan(bld.x + bld.w)
      expect(p.y).toBeGreaterThanOrEqual(bld.y)
      expect(p.y).toBeLessThan(bld.y + bld.h)
    }
  })
})

describe('tier defaults', () => {
  it('a building without the trait behaves exactly as tier 1', () => {
    const { world, player } = makeWorld()
    const factory = spawnFactory(world, player)
    expect(factory.has(FacilityTiers)).toBe(false)
    expect(facilityEfficiencyMul(factory)).toBe(1.0)
    expect(isFacilityInDowntime(factory)).toBe(false)
  })
})

describe('downtime takes the seats offline', () => {
  // A worked shift ending during downtime books no revenue and pays no
  // salary (the same payout gate the insolvency closure uses); maintenance
  // is charged unconditionally by dailyEconomics, untouched here.
  // 2026-05-18 is a Monday — a factory_worker_day workday (shift 8–18).
  const SHIFT_END = new Date(2026, 4, 18, 18, 5, 0)
  const WINDOW_MIN = 10
  // Same day-id derivation workSystem uses — keeps todayPerf from being
  // reset as "stale" before the payout fires.
  const SHIFT_DAY = Math.floor(SHIFT_END.getTime() / (24 * 60 * 60 * 1000))

  function spawnWorkedShift(world: ReturnType<typeof createWorld>) {
    const station = world.spawn(
      Position({ x: 5 * TILE, y: 6 * TILE }),
      Workstation({ specId: 'factory_worker_day', occupant: null }),
      EntityKey({ key: 'ws-shift' }),
    )
    const worker = world.spawn(
      Character({ name: '工人', color: '#fff', title: '' }),
      Job({ workstation: station, unemployedSinceMs: 0 }),
      JobPerformance({ todayPerf: 80, lastUpdateDay: SHIFT_DAY, wasInWindow: true }),
      Action({ kind: 'working', remaining: 0, total: 0 }),
      Money({ amount: 0 }),
      EntityKey({ key: 'npc-shift-worker' }),
    )
    station.set(Workstation, { ...station.get(Workstation)!, occupant: worker })
    return worker
  }

  it('baseline: a shift ending normally books revenue and pays the wage', () => {
    const { world, player } = makeWorld()
    const factory = spawnFactory(world, player)
    const worker = spawnWorkedShift(world)
    workSystem(world, SHIFT_END, WINDOW_MIN)
    const fac = factory.get(Facility)!
    expect(fac.revenueAcc).toBeGreaterThan(0)
    expect(fac.salariesAcc).toBeGreaterThan(0)
    expect(worker.get(Money)!.amount).toBeGreaterThan(0)
  })

  it('in downtime: the same shift books nothing and pays nothing', () => {
    const { world, player } = makeWorld()
    const factory = spawnFactory(world, player)
    const worker = spawnWorkedShift(world)
    factory.add(FacilityTiers)
    factory.set(FacilityTiers, {
      ...factory.get(FacilityTiers)!,
      upgrade: { knob: 'jobSiteCount', toTier: 2, daysRemaining: 2 },
    })
    workSystem(world, SHIFT_END, WINDOW_MIN)
    const fac = factory.get(Facility)!
    expect(fac.revenueAcc, 'downtime seats must produce no output').toBe(0)
    expect(fac.salariesAcc, 'downtime seats must pay no salary').toBe(0)
    expect(worker.get(Money)!.amount).toBe(0)
  })

  it('a research lab in downtime credits no progress', () => {
    const { world, civ, player } = makeWorld()
    const lab = world.spawn(
      Building({ x: 0, y: 0, w: 10 * TILE, h: 10 * TILE, label: '研究室', typeId: 'researchLab' }),
      Owner({ kind: 'character', entity: player }),
      Facility({
        revenueAcc: 0, salariesAcc: 0, insolventDays: 0,
        lastRolloverDay: 0, closedSinceDay: 0, closedReason: null,
      }),
      EntityKey({ key: 'bld-lab' }),
    )
    const station = world.spawn(
      Position({ x: 4 * TILE, y: 4 * TILE }),
      Workstation({ specId: 'researcher', occupant: null }),
      EntityKey({ key: 'ws-researcher' }),
    )
    const npc = world.spawn(
      Character({ name: '研究员', color: '#fff', title: '研究员' }),
      Job({ workstation: station, unemployedSinceMs: 0 }),
      EntityKey({ key: 'npc-researcher' }),
    )
    station.set(Workstation, { ...station.get(Workstation)!, occupant: npc })
    civ.add(FactionResearch)
    civ.set(FactionResearch, {
      queue: [], accumulated: 0, yesterdayPerDay: 0,
      lostOverflowToday: 0, completed: [],
    })
    enqueueResearch(civ, 'factory-tier-2')

    lab.add(FacilityTiers)
    lab.set(FacilityTiers, {
      ...lab.get(FacilityTiers)!,
      upgrade: { knob: 'efficiency', toTier: 2, daysRemaining: 1 },
    })
    const result = researchSystem(world, 1)
    expect(result.researchersWorked, 'a lab in downtime must credit nothing').toBe(0)
    expect(result.progressGenerated).toBe(0)
  })
})

describe('save round-trip', () => {
  it('tier state and in-progress downtime survive snapshot → restore', () => {
    const { world, civ, player } = makeWorld()
    const factory = spawnFactory(world, player)
    addFactionUnlock(civ, FACTORY_T2_UNLOCK)
    startTierUpgrade(world, factory, 'jobSiteCount', 2)
    facilityTierDowntimeSystem(world) // 1 of 3 days served
    const snaps = snapshotFacilityTiers(world)

    const { world: w2, player: p2 } = makeWorld()
    const f2 = spawnFactory(w2, p2)
    restoreFacilityTiers(w2, snaps)
    const tiers = f2.get(FacilityTiers)!
    expect(tiers.jobSiteCount).toBe(1)
    expect(tiers.upgrade).toEqual({
      knob: 'jobSiteCount', toTier: 2,
      daysRemaining: facilityTierLadder('factory')!.jobSiteCount[1].downtimeDays! - 1,
    })
    expect(isFacilityInDowntime(f2)).toBe(true)
  })

  it('a completed tier restores with its seats respawned', () => {
    const { world, civ, player } = makeWorld()
    const factory = spawnFactory(world, player)
    addFactionUnlock(civ, FACTORY_T2_UNLOCK)
    const row = facilityTierLadder('factory')!.jobSiteCount[1]
    startTierUpgrade(world, factory, 'jobSiteCount', 2)
    for (let d = 0; d < row.downtimeDays!; d++) facilityTierDowntimeSystem(world)
    const snaps = snapshotFacilityTiers(world)

    const { world: w2, player: p2 } = makeWorld()
    spawnFactory(w2, p2)
    const seatsBefore = factoryStationCount(w2)
    restoreFacilityTiers(w2, snaps)
    expect(factoryStationCount(w2), 'restore must respawn tier-added seats')
      .toBe(seatsBefore + row.addStations!.length)
  })
})
