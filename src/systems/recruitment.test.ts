// Phase 5.5.4 recruitment unit tests. Drives the system through a koota
// createWorld() rather than the live game world, mirroring the
// secretaryRoster + housingPressure test patterns.

import { describe, expect, it, beforeEach } from 'vitest'
import { createWorld } from 'koota'
import {
  Applicant, Building, Character, EntityKey, Facility, IsPlayer, Job,
  Money, Owner, Position, RecruitedTo, Recruiter, Workstation,
} from '../ecs/traits'
import {
  applicantMatchesCriteria, debugSpawnApplicant, eligibleRecruiterHires,
  findOwnedRecruiterStation, installRecruiter, lobbyForStation,
  manualAcceptApplicant, recruitmentSystem, rejectApplicant,
  resetRecruitmentState,
} from './recruitment'
import { worldConfig } from '../config'

const TILE = worldConfig.tilePx

beforeEach(() => {
  resetRecruitmentState()
})

function spawnPlayer(world: ReturnType<typeof createWorld>) {
  return world.spawn(
    Character({ name: '玩家', color: '#fff', title: '' }),
    IsPlayer(),
    Money({ amount: 0 }),
    EntityKey({ key: 'player' }),
  )
}

function spawnPlayerOwnedRecruitOffice(
  world: ReturnType<typeof createWorld>,
  player: ReturnType<typeof spawnPlayer>,
  origin = { x: 0, y: 0 },
) {
  const building = world.spawn(
    Building({ x: origin.x, y: origin.y, w: 10 * TILE, h: 10 * TILE, label: 'recruitOffice', typeId: 'recruitOffice' }),
    Owner({ kind: 'character', entity: player }),
    Facility({
      revenueAcc: 0, salariesAcc: 0, insolventDays: 0,
      lastRolloverDay: 0, closedSinceDay: 0, closedReason: null,
    }),
    EntityKey({ key: 'bld-recruit' }),
  )
  return building
}

function spawnRecruiterStation(
  world: ReturnType<typeof createWorld>,
  origin: { x: number; y: number },
  occupant: ReturnType<typeof spawnPlayer> | null,
) {
  return world.spawn(
    Position({ x: origin.x + 4 * TILE, y: origin.y + 4 * TILE }),
    Workstation({ specId: 'recruiter', occupant }),
    Recruiter,
    EntityKey({ key: 'ws-recruiter' }),
  )
}

function spawnRecruiterNPC(
  world: ReturnType<typeof createWorld>,
  station: ReturnType<typeof spawnRecruiterStation>,
) {
  // Use the koota-only minimal trait set the recruitment system reads.
  return world.spawn(
    Character({ name: '招聘专员', color: '#fff', title: '招聘专员' }),
    Money({ amount: 0 }),
    Job({ workstation: station, unemployedSinceMs: 0 }),
    EntityKey({ key: 'npc-recruiter' }),
  )
}

describe('installRecruiter', () => {
  it('seats a civilian and writes the occupant ref', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const bld = spawnPlayerOwnedRecruitOffice(world, player)
    const ws = spawnRecruiterStation(world, bld.get(Building)!, null)
    const civ = world.spawn(
      Character({ name: 'A', color: '#fff', title: '市民' }),
      Job({ workstation: null, unemployedSinceMs: 0 }),
      EntityKey({ key: 'civ-a' }),
    )
    expect(installRecruiter(ws, civ)).toBe(true)
    expect(ws.get(Workstation)!.occupant).toBe(civ)
  })

  it('stamps RecruitedTo when player is supplied', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const bld = spawnPlayerOwnedRecruitOffice(world, player)
    const ws = spawnRecruiterStation(world, bld.get(Building)!, null)
    const civ = world.spawn(
      Character({ name: 'A', color: '#fff', title: '市民' }),
      Job({ workstation: null, unemployedSinceMs: 0 }),
      EntityKey({ key: 'civ-a' }),
    )
    expect(installRecruiter(ws, civ, player)).toBe(true)
    expect(civ.has(RecruitedTo)).toBe(true)
    expect(civ.get(RecruitedTo)!.owner).toBe(player)
  })

  it('refuses to overwrite a seated recruiter', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const bld = spawnPlayerOwnedRecruitOffice(world, player)
    const ws = spawnRecruiterStation(world, bld.get(Building)!, null)
    const a = world.spawn(Character({ name: 'A', color: '#fff', title: '' }), Job, EntityKey({ key: 'a' }))
    const b = world.spawn(Character({ name: 'B', color: '#fff', title: '' }), Job, EntityKey({ key: 'b' }))
    expect(installRecruiter(ws, a)).toBe(true)
    expect(installRecruiter(ws, b)).toBe(false)
    expect(ws.get(Workstation)!.occupant).toBe(a)
  })
})

describe('debugSpawnApplicant + lobbyForStation', () => {
  it('spawns an applicant entity tagged with Applicant + recruiterStation', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const bld = spawnPlayerOwnedRecruitOffice(world, player)
    const ws = spawnRecruiterStation(world, bld.get(Building)!, null)
    spawnRecruiterNPC(world, ws)
    const a = debugSpawnApplicant(world, ws)
    expect(a).not.toBeNull()
    expect(a!.has(Applicant)).toBe(true)
    expect(a!.get(Applicant)!.recruiterStation).toBe(ws)
    expect(lobbyForStation(world, ws).length).toBe(1)
  })

  it('returns null for a non-recruiter workstation', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const bld = spawnPlayerOwnedRecruitOffice(world, player)
    const ws = world.spawn(
      Position({ x: 4 * TILE, y: 4 * TILE }),
      Workstation({ specId: 'bartender', occupant: null }),
      EntityKey({ key: 'ws-bar' }),
    )
    expect(debugSpawnApplicant(world, ws)).toBeNull()
    void bld
  })
})

describe('manualAcceptApplicant + rejectApplicant', () => {
  it('accept removes the Applicant trait and grants a Job marker', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const bld = spawnPlayerOwnedRecruitOffice(world, player)
    const ws = spawnRecruiterStation(world, bld.get(Building)!, null)
    spawnRecruiterNPC(world, ws)
    const a = debugSpawnApplicant(world, ws)!
    expect(manualAcceptApplicant(world, a, player)).toBe(true)
    expect(a.has(Applicant)).toBe(false)
    expect(a.has(Job)).toBe(true)
  })

  it('accept stamps RecruitedTo pointing at the player', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const bld = spawnPlayerOwnedRecruitOffice(world, player)
    const ws = spawnRecruiterStation(world, bld.get(Building)!, null)
    spawnRecruiterNPC(world, ws)
    const a = debugSpawnApplicant(world, ws)!
    manualAcceptApplicant(world, a, player)
    expect(a.has(RecruitedTo)).toBe(true)
    expect(a.get(RecruitedTo)!.owner).toBe(player)
  })

  it('reject destroys the entity and clears the lobby', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const bld = spawnPlayerOwnedRecruitOffice(world, player)
    const ws = spawnRecruiterStation(world, bld.get(Building)!, null)
    spawnRecruiterNPC(world, ws)
    const a = debugSpawnApplicant(world, ws)!
    expect(rejectApplicant(a)).toBe(true)
    expect(lobbyForStation(world, ws).length).toBe(0)
  })
})

describe('applicantMatchesCriteria', () => {
  it('returns true when no skill gate is set', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const bld = spawnPlayerOwnedRecruitOffice(world, player)
    const ws = spawnRecruiterStation(world, bld.get(Building)!, null)
    spawnRecruiterNPC(world, ws)
    const a = debugSpawnApplicant(world, ws)!
    expect(applicantMatchesCriteria(a, { skill: null, minLevel: 0 })).toBe(true)
  })

  it('checks min level against the top skill on a matching skill gate', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const bld = spawnPlayerOwnedRecruitOffice(world, player)
    const ws = spawnRecruiterStation(world, bld.get(Building)!, null)
    spawnRecruiterNPC(world, ws)
    const a = debugSpawnApplicant(world, ws)!
    // Force-set the applicant's top skill so the gate is deterministic.
    const data = a.get(Applicant)!
    a.set(Applicant, { ...data, topSkillId: 'piloting', topSkillLevel: 30 })
    expect(applicantMatchesCriteria(a, { skill: 'piloting', minLevel: 25 })).toBe(true)
    expect(applicantMatchesCriteria(a, { skill: 'piloting', minLevel: 50 })).toBe(false)
  })
})

describe('recruitmentSystem', () => {
  it('skips when no recruiter is seated', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const bld = spawnPlayerOwnedRecruitOffice(world, player)
    spawnRecruiterStation(world, bld.get(Building)!, null)
    const r = recruitmentSystem(world, 1)
    expect(r.recruitersChecked).toBe(0)
    expect(r.applicantsSpawned).toBe(0)
  })

  it('checks each seated recruiter once per game day', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const bld = spawnPlayerOwnedRecruitOffice(world, player)
    const ws = spawnRecruiterStation(world, bld.get(Building)!, null)
    const npc = spawnRecruiterNPC(world, ws)
    ws.set(Workstation, { ...ws.get(Workstation)!, occupant: npc })
    const r1 = recruitmentSystem(world, 1)
    expect(r1.recruitersChecked).toBe(1)
    // Same day: skip.
    const r2 = recruitmentSystem(world, 1)
    expect(r2.recruitersChecked).toBe(0)
    // New day: counted.
    const r3 = recruitmentSystem(world, 2)
    expect(r3.recruitersChecked).toBe(1)
  })

  it('expires applicants past their lifetime', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const bld = spawnPlayerOwnedRecruitOffice(world, player)
    const ws = spawnRecruiterStation(world, bld.get(Building)!, null)
    spawnRecruiterNPC(world, ws)
    const a = debugSpawnApplicant(world, ws)!
    // Set expiresMs to one ms before "now" — useClock's gameDate is set
    // in test by zustand's default state (year-77 epoch). Use the
    // applicant's existing expiresMs as the reference and roll it back.
    const data = a.get(Applicant)!
    a.set(Applicant, { ...data, expiresMs: data.expiresMs - 24 * 60 * 60 * 1000 * 30 })
    const r = recruitmentSystem(world, 100)
    expect(r.applicantsExpired).toBe(1)
    expect(lobbyForStation(world, ws).length).toBe(0)
  })
})

describe('eligibleRecruiterHires + findOwnedRecruiterStation', () => {
  it('finds the player-owned recruiter station once seated', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const bld = spawnPlayerOwnedRecruitOffice(world, player)
    const ws = spawnRecruiterStation(world, bld.get(Building)!, null)
    expect(findOwnedRecruiterStation(world, player)).toBe(ws)
  })

  it('lists civilians without a job, excludes the player + applicants', () => {
    const world = createWorld()
    const player = spawnPlayer(world)
    const bld = spawnPlayerOwnedRecruitOffice(world, player)
    const ws = spawnRecruiterStation(world, bld.get(Building)!, null)
    spawnRecruiterNPC(world, ws)
    debugSpawnApplicant(world, ws)
    const civ = world.spawn(
      Character({ name: 'A', color: '#fff', title: '市民' }),
      Job({ workstation: null, unemployedSinceMs: 0 }),
      EntityKey({ key: 'civ-a' }),
    )
    const eligible = eligibleRecruiterHires(world)
    expect(eligible).toContain(civ)
    expect(eligible).not.toContain(player)
  })
})
