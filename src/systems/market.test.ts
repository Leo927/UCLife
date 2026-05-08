// Phase 5.5.4 follow-up: installOnly seats (secretary, recruiter) must
// stay closed to the BT find-job loop. NPCs auto-claiming a player-
// faction-misc desk would let a state-owned faction office "open" itself
// without a player owner — breaking the design's invariant that those
// desks only exist as a player convenience.

import { describe, expect, it } from 'vitest'
import { createWorld } from 'koota'
import {
  Building, Character, EntityKey, IsPlayer, Job, Owner, Position,
  RecruitedTo, Workstation,
} from '../ecs/traits'
import { claimJob, findBestOpenJob } from './market'

function spawnCivilian(world: ReturnType<typeof createWorld>, key: string) {
  return world.spawn(
    Character({ name: key, color: '#fff', title: '市民' }),
    Job({ workstation: null, unemployedSinceMs: 0 }),
    EntityKey({ key }),
  )
}

describe('installOnly job specs', () => {
  it('findBestOpenJob skips secretary desks even when vacant', () => {
    const world = createWorld()
    const npc = spawnCivilian(world, 'a')
    world.spawn(
      Workstation({ specId: 'secretary', occupant: null, managerStation: null }),
      EntityKey({ key: 'ws-secretary' }),
    )
    expect(findBestOpenJob(world, npc)).toBeNull()
  })

  it('findBestOpenJob skips recruiter desks even when vacant', () => {
    const world = createWorld()
    const npc = spawnCivilian(world, 'a')
    world.spawn(
      Workstation({ specId: 'recruiter', occupant: null, managerStation: null }),
      EntityKey({ key: 'ws-recruiter' }),
    )
    expect(findBestOpenJob(world, npc)).toBeNull()
  })

  it('findBestOpenJob still picks ordinary vacant desks alongside installOnly ones', () => {
    const world = createWorld()
    const npc = spawnCivilian(world, 'a')
    const sec = world.spawn(
      Workstation({ specId: 'secretary', occupant: null, managerStation: null }),
      EntityKey({ key: 'ws-secretary' }),
    )
    const bartender = world.spawn(
      Workstation({ specId: 'bartender', occupant: null, managerStation: null }),
      EntityKey({ key: 'ws-bartender' }),
    )
    const pick = findBestOpenJob(world, npc)
    expect(pick).toBe(bartender)
    expect(pick).not.toBe(sec)
  })

  it('claimJob refuses an installOnly desk', () => {
    const world = createWorld()
    const npc = spawnCivilian(world, 'a')
    const sec = world.spawn(
      Workstation({ specId: 'secretary', occupant: null, managerStation: null }),
      EntityKey({ key: 'ws-secretary' }),
    )
    expect(claimJob(world, npc, sec)).toBe(false)
    expect(sec.get(Workstation)!.occupant).toBeNull()
    expect(npc.get(Job)!.workstation).toBeNull()
  })

  it('claimJob refuses a recruiter desk', () => {
    const world = createWorld()
    const npc = spawnCivilian(world, 'a')
    const rec = world.spawn(
      Workstation({ specId: 'recruiter', occupant: null, managerStation: null }),
      EntityKey({ key: 'ws-recruiter' }),
    )
    expect(claimJob(world, npc, rec)).toBe(false)
    expect(rec.get(Workstation)!.occupant).toBeNull()
  })

  it('claimJob still seats a worker on a non-installOnly desk', () => {
    const world = createWorld()
    const npc = spawnCivilian(world, 'a')
    const ws = world.spawn(
      Workstation({ specId: 'bartender', occupant: null, managerStation: null }),
      EntityKey({ key: 'ws-bartender' }),
    )
    expect(claimJob(world, npc, ws)).toBe(true)
    expect(ws.get(Workstation)!.occupant).toBe(npc)
  })
})

describe('RecruitedTo job-seek gate', () => {
  type AnyEntity = ReturnType<ReturnType<typeof createWorld>['spawn']>
  function spawnBuildingWithStation(
    world: ReturnType<typeof createWorld>,
    bldKey: string,
    wsKey: string,
    bldRect: { x: number; y: number; w: number; h: number },
    owner: { kind: 'character' | 'state' | 'faction'; entity: AnyEntity | null },
  ) {
    const bld = world.spawn(
      Building({ ...bldRect, label: bldKey, typeId: 'bar' }),
      Owner({ kind: owner.kind, entity: owner.entity }),
      EntityKey({ key: bldKey }),
    )
    const ws = world.spawn(
      Position({ x: bldRect.x + 1, y: bldRect.y + 1 }),
      Workstation({ specId: 'bartender', occupant: null, managerStation: null }),
      EntityKey({ key: wsKey }),
    )
    return { bld, ws }
  }

  it('findBestOpenJob skips a bartender desk outside the recruited owner', () => {
    const world = createWorld()
    const player = world.spawn(
      Character({ name: 'P', color: '#fff', title: '' }),
      IsPlayer(),
      EntityKey({ key: 'player' }),
    )
    const npc = spawnCivilian(world, 'recruit')
    npc.add(RecruitedTo({ owner: player }))

    spawnBuildingWithStation(
      world, 'bld-foreign', 'ws-foreign',
      { x: 0, y: 0, w: 32, h: 32 },
      { kind: 'state', entity: null },
    )

    expect(findBestOpenJob(world, npc)).toBeNull()
  })

  it('findBestOpenJob picks a workstation inside a player-owned building', () => {
    const world = createWorld()
    const player = world.spawn(
      Character({ name: 'P', color: '#fff', title: '' }),
      IsPlayer(),
      EntityKey({ key: 'player' }),
    )
    const npc = spawnCivilian(world, 'recruit')
    npc.add(RecruitedTo({ owner: player }))

    const { ws: foreignWs } = spawnBuildingWithStation(
      world, 'bld-foreign', 'ws-foreign',
      { x: 0, y: 0, w: 32, h: 32 },
      { kind: 'state', entity: null },
    )
    const { ws: ownedWs } = spawnBuildingWithStation(
      world, 'bld-owned', 'ws-owned',
      { x: 100, y: 0, w: 32, h: 32 },
      { kind: 'character', entity: player },
    )

    const pick = findBestOpenJob(world, npc)
    expect(pick).toBe(ownedWs)
    expect(pick).not.toBe(foreignWs)
  })

  it('claimJob refuses a non-faction-owned workstation for a recruited NPC', () => {
    const world = createWorld()
    const player = world.spawn(
      Character({ name: 'P', color: '#fff', title: '' }),
      IsPlayer(),
      EntityKey({ key: 'player' }),
    )
    const npc = spawnCivilian(world, 'recruit')
    npc.add(RecruitedTo({ owner: player }))

    const { ws } = spawnBuildingWithStation(
      world, 'bld-foreign', 'ws-foreign',
      { x: 0, y: 0, w: 32, h: 32 },
      { kind: 'state', entity: null },
    )

    expect(claimJob(world, npc, ws)).toBe(false)
    expect(ws.get(Workstation)!.occupant).toBeNull()
  })

  it('non-recruited NPCs ignore the gate', () => {
    const world = createWorld()
    const npc = spawnCivilian(world, 'civ')
    const { ws } = spawnBuildingWithStation(
      world, 'bld-foreign', 'ws-foreign',
      { x: 0, y: 0, w: 32, h: 32 },
      { kind: 'state', entity: null },
    )
    expect(findBestOpenJob(world, npc)).toBe(ws)
    expect(claimJob(world, npc, ws)).toBe(true)
  })
})
