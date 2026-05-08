// Phase 5.5.6 research system unit tests. Drives the system through a
// koota createWorld() rather than the live game world, mirroring the
// recruitment / secretaryRoster / housingPressure test patterns.

import { describe, expect, it } from 'vitest'
import { createWorld } from 'koota'
import {
  Building, Character, EntityKey, Faction, FactionResearch, FactionSheet,
  FactionUnlocks, Facility, IsPlayer, Job, Money, Owner, Position, Workstation,
  FactionEffectsList,
} from '../ecs/traits'
import { createFactionSheet } from '../stats/factionSchema'
import { setBase } from '../stats/sheet'
import {
  cancelHead, dequeueResearch, enqueueResearch, plannerView, reorderQueue,
  researchSystem, findFactionForResearcherStation,
} from './research'
import { worldConfig, researchConfig } from '../config'
import { hasFactionUnlock } from '../ecs/factionEffects'

const TILE = worldConfig.tilePx

function makeWorld() {
  const world = createWorld()
  // Bootstrap a 'civilian' Faction with the research traits attached.
  const civ = world.spawn(
    Faction({ id: 'civilian', fund: 0 }),
    EntityKey({ key: 'faction-civilian' }),
    FactionSheet({ sheet: createFactionSheet() }),
    FactionEffectsList({ list: [] }),
    FactionUnlocks({ ids: [] }),
    FactionResearch({
      queue: [], accumulated: 0, yesterdayPerDay: 0,
      lostOverflowToday: 0, completed: [],
    }),
  )
  return { world, civ }
}

function spawnPlayer(world: ReturnType<typeof createWorld>) {
  return world.spawn(
    Character({ name: '玩家', color: '#fff', title: '' }),
    IsPlayer(),
    Money({ amount: 0 }),
    EntityKey({ key: 'player' }),
  )
}

function spawnPlayerOwnedLab(
  world: ReturnType<typeof createWorld>,
  player: ReturnType<typeof spawnPlayer>,
) {
  return world.spawn(
    Building({ x: 0, y: 0, w: 10 * TILE, h: 10 * TILE, label: '研究室', typeId: 'researchLab' }),
    Owner({ kind: 'character', entity: player }),
    Facility({
      revenueAcc: 0, salariesAcc: 0, insolventDays: 0,
      lastRolloverDay: 0, closedSinceDay: 0, closedReason: null,
    }),
    EntityKey({ key: 'bld-lab' }),
  )
}

function spawnResearcherStation(world: ReturnType<typeof createWorld>) {
  return world.spawn(
    Position({ x: 4 * TILE, y: 4 * TILE }),
    Workstation({ specId: 'researcher', occupant: null }),
    EntityKey({ key: 'ws-researcher' }),
  )
}

function spawnSeatedResearcher(
  world: ReturnType<typeof createWorld>,
  station: ReturnType<typeof spawnResearcherStation>,
) {
  const npc = world.spawn(
    Character({ name: '研究员', color: '#fff', title: '研究员' }),
    Job({ workstation: station, unemployedSinceMs: 0 }),
    EntityKey({ key: 'npc-researcher' }),
  )
  const cur = station.get(Workstation)!
  station.set(Workstation, { ...cur, occupant: npc })
  return npc
}

describe('enqueueResearch', () => {
  it('appends a valid research id', () => {
    const { civ } = makeWorld()
    expect(enqueueResearch(civ, 'factory-tier-2')).toBe(true)
    expect(civ.get(FactionResearch)!.queue).toEqual(['factory-tier-2'])
  })

  it('refuses a duplicate', () => {
    const { civ } = makeWorld()
    enqueueResearch(civ, 'factory-tier-2')
    expect(enqueueResearch(civ, 'factory-tier-2')).toBe(false)
  })

  it('refuses an unknown id', () => {
    const { civ } = makeWorld()
    expect(enqueueResearch(civ, 'no-such-research')).toBe(false)
  })
})

describe('researchSystem', () => {
  it('credits per-shift progress to the queue head', () => {
    const { world, civ } = makeWorld()
    const player = spawnPlayer(world)
    spawnPlayerOwnedLab(world, player)
    const station = spawnResearcherStation(world)
    spawnSeatedResearcher(world, station)
    enqueueResearch(civ, 'factory-tier-2')

    const result = researchSystem(world, 1)
    expect(result.labsChecked).toBe(1)
    expect(result.researchersWorked).toBe(1)
    const expected = researchConfig.baseResearchPerShift  // perf=1.0, eff=1.0, speedMul=1.0
    expect(result.progressGenerated).toBeCloseTo(expected, 5)
    const fr = civ.get(FactionResearch)!
    expect(fr.accumulated).toBeCloseTo(expected, 5)
    expect(fr.yesterdayPerDay).toBeCloseTo(expected, 5)
  })

  it('completes the head and rolls overflow into the next entry', () => {
    const { world, civ } = makeWorld()
    const player = spawnPlayer(world)
    spawnPlayerOwnedLab(world, player)
    const station = spawnResearcherStation(world)
    spawnSeatedResearcher(world, station)

    // Pump a researchSpeedMul that completes factory-tier-2 (cost 500) in
    // a single rollover and leaves measurable overflow.
    const fs = civ.get(FactionSheet)!
    civ.set(FactionSheet, { sheet: setBase(fs.sheet, 'researchSpeedMul', 100) })

    enqueueResearch(civ, 'factory-tier-2')
    // No second item — overflow should be lost (queue empty after head).
    const result = researchSystem(world, 1)
    expect(result.completed).toEqual(['factory-tier-2'])
    const fr = civ.get(FactionResearch)!
    expect(fr.completed).toContain('factory-tier-2')
    expect(fr.queue).toEqual([])
    expect(fr.accumulated).toBe(0)
    expect(fr.lostOverflowToday).toBeGreaterThan(0)
    expect(hasFactionUnlock(civ, 'upgrade:factory-tier-2')).toBe(true)
  })

  it('produces no progress when the lab is closed for insolvency', () => {
    const { world, civ } = makeWorld()
    const player = spawnPlayer(world)
    const lab = spawnPlayerOwnedLab(world, player)
    const station = spawnResearcherStation(world)
    spawnSeatedResearcher(world, station)
    enqueueResearch(civ, 'factory-tier-2')

    const fac = lab.get(Facility)!
    lab.set(Facility, { ...fac, closedSinceDay: 1, closedReason: 'insolvent' })

    const result = researchSystem(world, 2)
    expect(result.researchersWorked).toBe(0)
    expect(civ.get(FactionResearch)!.accumulated).toBe(0)
  })

  it('reports lost overflow when the queue is empty', () => {
    const { world, civ } = makeWorld()
    const player = spawnPlayer(world)
    spawnPlayerOwnedLab(world, player)
    const station = spawnResearcherStation(world)
    spawnSeatedResearcher(world, station)
    // Queue stays empty.

    const result = researchSystem(world, 1)
    expect(result.lostOverflow).toBeGreaterThan(0)
    expect(civ.get(FactionResearch)!.lostOverflowToday)
      .toBeCloseTo(researchConfig.baseResearchPerShift, 5)
  })

  it('clears yesterday\'s lostOverflowToday before adding today\'s', () => {
    const { world, civ } = makeWorld()
    const player = spawnPlayer(world)
    spawnPlayerOwnedLab(world, player)
    const station = spawnResearcherStation(world)
    spawnSeatedResearcher(world, station)

    civ.set(FactionResearch, {
      ...civ.get(FactionResearch)!, lostOverflowToday: 9999,
    })
    researchSystem(world, 1)
    expect(civ.get(FactionResearch)!.lostOverflowToday).not.toBe(9999)
  })
})

describe('cancelHead / dequeueResearch / reorderQueue', () => {
  it('cancelHead drops the head and discards accumulated', () => {
    const { civ } = makeWorld()
    enqueueResearch(civ, 'factory-tier-2')
    civ.set(FactionResearch, { ...civ.get(FactionResearch)!, accumulated: 200 })
    expect(cancelHead(civ)).toBe(true)
    expect(civ.get(FactionResearch)!.queue).toEqual([])
    expect(civ.get(FactionResearch)!.accumulated).toBe(0)
  })

  it('dequeueResearch refuses to drop the head', () => {
    const { civ } = makeWorld()
    enqueueResearch(civ, 'factory-tier-2')
    expect(dequeueResearch(civ, 'factory-tier-2')).toBe(false)
  })

  it('reorderQueue from-head discards accumulated', () => {
    const { civ } = makeWorld()
    // Two-entry queue (synthetic — second id is unknown but the helper
    // tolerates that since it only swaps strings).
    civ.set(FactionResearch, {
      ...civ.get(FactionResearch)!,
      queue: ['factory-tier-2', 'placeholder-2'],
      accumulated: 200,
    })
    expect(reorderQueue(civ, 0, 1)).toBe(true)
    expect(civ.get(FactionResearch)!.queue[0]).toBe('placeholder-2')
    expect(civ.get(FactionResearch)!.accumulated).toBe(0)
  })
})

describe('plannerView', () => {
  it('classifies catalog rows into queue/available/locked/done', () => {
    const { civ } = makeWorld()
    enqueueResearch(civ, 'factory-tier-2')
    const view = plannerView(civ)!
    expect(view.queue.map((r) => r.id)).toEqual(['factory-tier-2'])
    // No other catalog rows in 5.5.6, so available + locked + done are all empty.
    expect(view.available.length).toBe(0)
    expect(view.locked.length).toBe(0)
    expect(view.done.length).toBe(0)
  })

  it('exposes accumulated for the head row only', () => {
    const { civ } = makeWorld()
    enqueueResearch(civ, 'factory-tier-2')
    civ.set(FactionResearch, { ...civ.get(FactionResearch)!, accumulated: 88 })
    const view = plannerView(civ)!
    expect(view.queue[0].accumulatedAtHead).toBe(true)
    expect(view.queue[0].accumulated).toBe(88)
  })
})

describe('findFactionForResearcherStation', () => {
  it('routes a player-owned lab to the civilian faction (pre-creation alias)', () => {
    const { world, civ } = makeWorld()
    const player = spawnPlayer(world)
    spawnPlayerOwnedLab(world, player)
    const station = spawnResearcherStation(world)
    expect(findFactionForResearcherStation(world, station)).toBe(civ)
  })
})
