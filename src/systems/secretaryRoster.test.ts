import { describe, expect, it } from 'vitest'
import { createWorld } from 'koota'
import {
  Bed, Building, Character, EntityKey, Facility, IsPlayer, Job, Money,
  Owner, Position, RecruitedTo, Workstation,
} from '../ecs/traits'
import {
  assignBeds, assignIdleMembers, assignIdleMembersToBuilding,
  bookSummary, facilityRoster, factionStatus,
  installSecretary, sidewaysReport,
} from './secretaryRoster'
import { worldConfig } from '../config'

const TILE = worldConfig.tilePx

function spawnPlayer(world: ReturnType<typeof createWorld>, money = 0) {
  return world.spawn(
    Character({ name: '玩家', color: '#fff', title: '' }),
    IsPlayer(),
    Money({ amount: money }),
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

function spawnPlayerOwnedBldg(
  world: ReturnType<typeof createWorld>,
  typeId: string,
  key: string,
  owner: ReturnType<typeof spawnPlayer>,
  origin = { x: 0, y: 0 },
) {
  return world.spawn(
    Building({ x: origin.x, y: origin.y, w: 10 * TILE, h: 10 * TILE, label: typeId, typeId }),
    Owner({ kind: 'character', entity: owner }),
    Facility({
      revenueAcc: 0, salariesAcc: 0, insolventDays: 0,
      lastRolloverDay: 0, closedSinceDay: 0, closedReason: null,
    }),
    EntityKey({ key }),
  )
}

function spawnWs(
  world: ReturnType<typeof createWorld>,
  origin: { x: number; y: number },
  specId: string,
  occupant: ReturnType<typeof spawnMember> | null,
  key: string,
) {
  return world.spawn(
    Position({ x: origin.x + 1 * TILE, y: origin.y + 1 * TILE }),
    Workstation({ specId, occupant }),
    EntityKey({ key }),
  )
}

function spawnBed(
  world: ReturnType<typeof createWorld>,
  origin: { x: number; y: number },
  claimedBy: ReturnType<typeof spawnMember> | null,
  key: string,
) {
  return world.spawn(
    Position({ x: origin.x + 2 * TILE, y: origin.y + 2 * TILE }),
    Bed({ tier: 'apartment', nightlyRent: 100, occupant: null, rentPaidUntilMs: 0, owned: false, claimedBy }),
    EntityKey({ key }),
  )
}

describe('assignIdleMembers', () => {
  it('fills vacant stations from the idle pool', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const apt = spawnPlayerOwnedBldg(world, 'apartment', 'bld-apt', player)
    const aptOrigin = apt.get(Building)!
    const m = spawnMember(world, 'm1')
    spawnBed(world, aptOrigin, m, 'bed-1')
    const bar = spawnPlayerOwnedBldg(world, 'bar', 'bld-bar', player, { x: 100 * TILE, y: 100 * TILE })
    const barOrigin = bar.get(Building)!
    const ws = spawnWs(world, barOrigin, 'bartender', null, 'ws-1')

    const summary = assignIdleMembers(world, player)
    expect(summary.assigned).toBe(1)
    expect(ws.get(Workstation)!.occupant).toBe(m)
  })

  it('reports unassigned when there are no vacancies', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const apt = spawnPlayerOwnedBldg(world, 'apartment', 'bld-apt', player)
    const aptOrigin = apt.get(Building)!
    const m = spawnMember(world, 'm1')
    spawnBed(world, aptOrigin, m, 'bed-1')
    const summary = assignIdleMembers(world, player)
    expect(summary.assigned).toBe(0)
    expect(summary.unassigned).toBe(1)
  })
})

describe('assignIdleMembersToBuilding', () => {
  it('only fills vacancies inside the named building', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const apt = spawnPlayerOwnedBldg(world, 'apartment', 'bld-apt', player)
    const aptOrigin = apt.get(Building)!
    const m1 = spawnMember(world, 'm1')
    const m2 = spawnMember(world, 'm2')
    spawnBed(world, aptOrigin, m1, 'bed-1')
    spawnBed(world, aptOrigin, m2, 'bed-2')
    // Two facilities, each with one vacant station — scoping should
    // only fill the one we name.
    const officeA = spawnPlayerOwnedBldg(world, 'factionOffice', 'bld-a', player, { x: 100 * TILE, y: 0 })
    const officeB = spawnPlayerOwnedBldg(world, 'factionOffice', 'bld-b', player, { x: 200 * TILE, y: 0 })
    const wsA = spawnWs(world, officeA.get(Building)!, 'secretary', null, 'ws-a')
    const wsB = spawnWs(world, officeB.get(Building)!, 'secretary', null, 'ws-b')

    const summary = assignIdleMembersToBuilding(world, player, officeA)
    expect(summary.assigned).toBe(1)
    expect(wsA.get(Workstation)!.occupant).not.toBeNull()
    expect(wsB.get(Workstation)!.occupant).toBeNull()
  })

  it('reports zero when the building has no vacancies', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const office = spawnPlayerOwnedBldg(world, 'factionOffice', 'bld-1', player)
    const m = spawnMember(world, 'm1')
    spawnWs(world, office.get(Building)!, 'secretary', m, 'ws-1')
    const summary = assignIdleMembersToBuilding(world, player, office)
    expect(summary.assigned).toBe(0)
  })
})

describe('facilityRoster', () => {
  it('partitions stations into vacant + occupied for a single building', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const apt = spawnPlayerOwnedBldg(world, 'apartment', 'bld-apt', player)
    const aptOrigin = apt.get(Building)!
    const m = spawnMember(world, 'm1')
    spawnBed(world, aptOrigin, m, 'bed-1')
    const office = spawnPlayerOwnedBldg(world, 'factionOffice', 'bld-1', player, { x: 100 * TILE, y: 0 })
    const occupiedWs = spawnWs(world, office.get(Building)!, 'secretary', m, 'ws-occ')
    m.set(Job, { workstation: occupiedWs, unemployedSinceMs: 0 })
    spawnWs(world, office.get(Building)!, 'secretary', null, 'ws-vac')

    const roster = facilityRoster(world, player, office)
    expect(roster).toHaveLength(2)
    const vacant = roster.filter((r) => r.occupant === null)
    const occupied = roster.filter((r) => r.occupant !== null)
    expect(vacant).toHaveLength(1)
    expect(occupied).toHaveLength(1)
    expect(occupied[0].occupant).toBe(m)
  })
})

describe('assignBeds', () => {
  it('claims unclaimed beds for unhoused members', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const bar = spawnPlayerOwnedBldg(world, 'bar', 'bld-bar', player)
    const barOrigin = bar.get(Building)!
    const m = spawnMember(world, 'm1')
    spawnWs(world, barOrigin, 'bartender', m, 'ws-1')
    m.set(Job, { workstation: world.queryFirst(Workstation)!, unemployedSinceMs: 0 })

    const apt = spawnPlayerOwnedBldg(world, 'apartment', 'bld-apt', player, { x: 200 * TILE, y: 200 * TILE })
    const aptOrigin = apt.get(Building)!
    const bedEnt = spawnBed(world, aptOrigin, null, 'bed-1')

    const r = assignBeds(world, player)
    expect(r.assigned).toBe(1)
    expect(bedEnt.get(Bed)!.claimedBy).toBe(m)
  })
})

describe('bookSummary', () => {
  it('sums per-facility revenue/salary and reads the wallet', () => {
    const world = createWorld()
    const player = spawnPlayer(world, 5000)
    const bar = spawnPlayerOwnedBldg(world, 'bar', 'bld-bar', player)
    const fac = bar.get(Facility)!
    bar.set(Facility, { ...fac, revenueAcc: 200, salariesAcc: 80 })
    const s = bookSummary(world, player)
    expect(s.fund).toBe(5000)
    expect(s.todayRevenue).toBe(200)
    expect(s.todaySalaries).toBe(80)
    // Maintenance comes from economics.json5; bar is 35.
    expect(s.todayMaintenance).toBe(35)
    expect(s.todayNet).toBe(200 - 80 - 35)
    expect(s.topRevenue.length).toBe(1)
    expect(s.topRevenue[0].label).toBe('bar')
  })
})

describe('sidewaysReport', () => {
  it('flags insolvent facilities + vacant stations + unhoused members', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const bar = spawnPlayerOwnedBldg(world, 'bar', 'bld-bar', player)
    const fac = bar.get(Facility)!
    bar.set(Facility, { ...fac, insolventDays: 2 })
    const barOrigin = bar.get(Building)!
    spawnWs(world, barOrigin, 'bartender', null, 'ws-1')
    // Member who'll be unhoused (works at the bar but has no bed claim).
    const m = spawnMember(world, 'm1')
    const ws2 = spawnWs(world, barOrigin, 'bartender', m, 'ws-2')
    m.set(Job, { workstation: ws2, unemployedSinceMs: 0 })

    const r = sidewaysReport(world, player)
    expect(r.insolventFacilities).toHaveLength(1)
    expect(r.vacantStations).toHaveLength(1)
    expect(r.unhousedCount).toBe(1)
  })
})

describe('factionStatus', () => {
  it('reports member / facility / bed counts', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const apt = spawnPlayerOwnedBldg(world, 'apartment', 'bld-apt', player)
    const aptOrigin = apt.get(Building)!
    spawnBed(world, aptOrigin, null, 'bed-1')
    spawnBed(world, aptOrigin, null, 'bed-2')
    const bar = spawnPlayerOwnedBldg(world, 'bar', 'bld-bar', player, { x: 100 * TILE, y: 100 * TILE })
    const barOrigin = bar.get(Building)!
    const m = spawnMember(world, 'm1')
    spawnWs(world, barOrigin, 'bartender', m, 'ws-1')

    const s = factionStatus(world, player)
    expect(s.memberCount).toBe(1)
    expect(s.facilityCount).toBe(2)
    expect(s.bedCount).toBe(2)
    expect(s.unhousedCount).toBe(1)
  })
})

describe('installSecretary', () => {
  it('seats a hire and sets their Job pointer', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const office = spawnPlayerOwnedBldg(world, 'factionOffice', 'bld-office', player)
    const officeOrigin = office.get(Building)!
    const ws = spawnWs(world, officeOrigin, 'secretary', null, 'ws-sec')
    const hire = spawnMember(world, 'civ-1')
    expect(installSecretary(ws, hire)).toBe(true)
    expect(ws.get(Workstation)!.occupant).toBe(hire)
    expect(hire.get(Job)!.workstation).toBe(ws)
  })

  it('refuses non-secretary stations', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const bar = spawnPlayerOwnedBldg(world, 'bar', 'bld-bar', player)
    const barOrigin = bar.get(Building)!
    const ws = spawnWs(world, barOrigin, 'bartender', null, 'ws-1')
    const hire = spawnMember(world, 'civ-1')
    expect(installSecretary(ws, hire)).toBe(false)
  })

  it('stamps RecruitedTo when player is supplied', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const office = spawnPlayerOwnedBldg(world, 'factionOffice', 'bld-office', player)
    const officeOrigin = office.get(Building)!
    const ws = spawnWs(world, officeOrigin, 'secretary', null, 'ws-sec')
    const hire = spawnMember(world, 'civ-1')
    expect(installSecretary(ws, hire, player)).toBe(true)
    expect(hire.has(RecruitedTo)).toBe(true)
    expect(hire.get(RecruitedTo)!.owner).toBe(player)
  })
})
