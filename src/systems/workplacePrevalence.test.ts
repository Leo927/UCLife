// Phase 4.2 — workplace prevalence log line. Player begins a work
// shift; if symptomatic infectious coworkers ≥ threshold, emit one
// zh-CN log line, gated to once per game-day.

import { describe, expect, it, afterEach } from 'vitest'
import { createWorld, type Entity, type World } from 'koota'
import { spawnPlayer, spawnNPC } from '../character/spawn'
import { Conditions, Job, JobPerformance, Workstation } from '../ecs/traits'
import { forceOnset } from './physiology'
import { onSim } from '../sim/events'
import {
  maybeEmitWorkplacePrevalence, countSymptomaticCoworkers,
} from './workplacePrevalence'
import { physiologyConfig } from '../config'

const worlds: World[] = []
const unsubs: Array<() => void> = []

afterEach(() => {
  while (unsubs.length) unsubs.pop()!()
  while (worlds.length) worlds.pop()!.destroy()
})

// Push a freshly-onset condition past incubation so the symptomatic
// check returns true. Mirrors the contagion test helper.
function makeSymptomatic(entity: Entity): void {
  const cond = entity.get(Conditions)!
  const list = cond.list.map((c) => ({ ...c, phase: 'rising' as const, severity: 30 }))
  entity.set(Conditions, { list })
}

interface Setup {
  world: World
  player: Entity
  playerWs: Entity
  manager: Entity
  coworkers: Entity[]  // seated at workstations sharing playerWs's managerStation
}

// Builds a minimal managed workplace: one manager workstation + N
// worker workstations whose managerStation points at the manager.
// The player is seated at one worker station; `coworkers` is the rest.
function setupManagedWorkplace(coworkerCount: number): Setup {
  const world = createWorld()
  worlds.push(world)
  const player = spawnPlayer(world, { x: 0, y: 0 })
  const manager = spawnNPC(world, { name: '主管', color: '#aaa', x: 0, y: 0, key: 'manager' })

  // Manager workstation (specId distinct so a stray specId fallback
  // doesn't accidentally include the player). occupant=manager binds
  // the seat without going through the recruiting-eligibility check.
  const managerWs = world.spawn(Workstation({ specId: 'factory_manager', occupant: manager, managerStation: null }))
  manager.set(Job, { workstation: managerWs, unemployedSinceMs: 0 })

  const playerWs = world.spawn(Workstation({ specId: 'worker', occupant: player, managerStation: managerWs }))
  player.set(Job, { workstation: playerWs, unemployedSinceMs: 0 })

  const coworkers: Entity[] = []
  for (let i = 0; i < coworkerCount; i++) {
    const c = spawnNPC(world, { name: `同事${i}`, color: '#aaa', x: 0, y: 0, key: `cw-${i}` })
    const cws = world.spawn(Workstation({ specId: 'worker', occupant: c, managerStation: managerWs }))
    c.set(Job, { workstation: cws, unemployedSinceMs: 0 })
    coworkers.push(c)
  }
  return { world, player, playerWs, manager, coworkers }
}

function captureLogs(): { logs: string[] } {
  const logs: string[] = []
  unsubs.push(onSim('log', (p) => { logs.push(p.textZh) }))
  return { logs }
}

describe('workplacePrevalence — count', () => {
  it('counts symptomatic infectious carriers among managed coworkers', () => {
    const { world, player, coworkers } = setupManagedWorkplace(4)
    forceOnset(coworkers[0], 'flu', 'seed', 1)
    forceOnset(coworkers[1], 'flu', 'seed', 1)
    forceOnset(coworkers[2], 'flu', 'seed', 1)
    makeSymptomatic(coworkers[0])
    makeSymptomatic(coworkers[1])
    makeSymptomatic(coworkers[2])
    expect(countSymptomaticCoworkers(world, player)).toBe(3)
  })

  it('incubating carriers (no symptoms) do not count', () => {
    const { world, player, coworkers } = setupManagedWorkplace(2)
    forceOnset(coworkers[0], 'flu', 'seed', 1)
    forceOnset(coworkers[1], 'flu', 'seed', 1)
    // No makeSymptomatic — both remain in 'incubating'.
    expect(countSymptomaticCoworkers(world, player)).toBe(0)
  })

  it('the player is not counted as their own coworker', () => {
    const { world, player } = setupManagedWorkplace(0)
    forceOnset(player, 'flu', 'seed', 1)
    makeSymptomatic(player)
    expect(countSymptomaticCoworkers(world, player)).toBe(0)
  })

  it('a sick worker at a different workplace does not count', () => {
    const { world, player, coworkers } = setupManagedWorkplace(1)
    // Spawn a separate managed workplace + a sick worker there.
    const otherMgrWs = world.spawn(Workstation({ specId: 'factory_manager', occupant: null, managerStation: null }))
    const outsider = spawnNPC(world, { name: '外人', color: '#aaa', x: 0, y: 0, key: 'outsider' })
    const otherWs = world.spawn(Workstation({ specId: 'worker', occupant: outsider, managerStation: otherMgrWs }))
    outsider.set(Job, { workstation: otherWs, unemployedSinceMs: 0 })
    forceOnset(outsider, 'flu', 'seed', 1)
    makeSymptomatic(outsider)
    // Sanity: existing coworker present but not symptomatic.
    expect(coworkers).toHaveLength(1)
    expect(countSymptomaticCoworkers(world, player)).toBe(0)
  })

  it('manager workstation is included as a coworker for subordinate players', () => {
    const { world, player, manager } = setupManagedWorkplace(0)
    forceOnset(manager, 'flu', 'seed', 1)
    makeSymptomatic(manager)
    expect(countSymptomaticCoworkers(world, player)).toBe(1)
  })
})

describe('workplacePrevalence — emit gate', () => {
  it('emits the zh-CN log line when coworker count >= threshold', () => {
    const { world, player, coworkers } = setupManagedWorkplace(3)
    for (const c of coworkers) {
      forceOnset(c, 'flu', 'seed', 1)
      makeSymptomatic(c)
    }
    const { logs } = captureLogs()
    const fired = maybeEmitWorkplacePrevalence(world, player, new Date(1000 * 86400_000))
    expect(fired).toBe(true)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toBe('今天有3位同事请病假。')
  })

  it('does not emit when coworker count is below threshold', () => {
    const { world, player, coworkers } = setupManagedWorkplace(3)
    // Only one sick — threshold defaults to 2.
    forceOnset(coworkers[0], 'flu', 'seed', 1)
    makeSymptomatic(coworkers[0])
    expect(physiologyConfig.workplacePrevalenceThreshold).toBeGreaterThan(1)
    const { logs } = captureLogs()
    const fired = maybeEmitWorkplacePrevalence(world, player, new Date(1000 * 86400_000))
    expect(fired).toBe(false)
    expect(logs).toHaveLength(0)
  })

  it('re-entry within the same game-day does not fire a second line', () => {
    const { world, player, coworkers } = setupManagedWorkplace(3)
    for (const c of coworkers) {
      forceOnset(c, 'flu', 'seed', 1)
      makeSymptomatic(c)
    }
    const { logs } = captureLogs()
    const t = new Date(1000 * 86400_000 + 8 * 60 * 60 * 1000)
    expect(maybeEmitWorkplacePrevalence(world, player, t)).toBe(true)
    // Same game-day, two hours later — must not fire again.
    const t2 = new Date(t.getTime() + 2 * 60 * 60 * 1000)
    expect(maybeEmitWorkplacePrevalence(world, player, t2)).toBe(false)
    expect(logs).toHaveLength(1)
  })

  it('fires again on a new game-day', () => {
    const { world, player, coworkers } = setupManagedWorkplace(3)
    for (const c of coworkers) {
      forceOnset(c, 'flu', 'seed', 1)
      makeSymptomatic(c)
    }
    const { logs } = captureLogs()
    const t = new Date(1000 * 86400_000)
    expect(maybeEmitWorkplacePrevalence(world, player, t)).toBe(true)
    const tNext = new Date(t.getTime() + 24 * 60 * 60 * 1000)
    expect(maybeEmitWorkplacePrevalence(world, player, tNext)).toBe(true)
    expect(logs).toHaveLength(2)
  })

  it('no Job → no emission (player not employed)', () => {
    const world = createWorld()
    worlds.push(world)
    const player = spawnPlayer(world, { x: 0, y: 0 })
    // Player has JobPerformance from spawn but no Job/workstation.
    const { logs } = captureLogs()
    const fired = maybeEmitWorkplacePrevalence(world, player, new Date(1000 * 86400_000))
    expect(fired).toBe(false)
    expect(logs).toHaveLength(0)
    expect(player.get(JobPerformance)?.lastWorkplacePrevalenceDay).toBe(-1)
  })
})
