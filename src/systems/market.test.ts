// Phase 5.5.4 follow-up: installOnly seats (secretary, recruiter) must
// stay closed to the BT find-job loop. NPCs auto-claiming a player-
// faction-misc desk would let a state-owned faction office "open" itself
// without a player owner — breaking the design's invariant that those
// desks only exist as a player convenience.

import { describe, expect, it } from 'vitest'
import { createWorld } from 'koota'
import { Character, EntityKey, Job, Workstation } from '../ecs/traits'
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
