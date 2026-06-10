// Phase 5.5.6 research system unit tests. Drives the system through a
// koota createWorld() rather than the live game world, mirroring the
// recruitment / secretaryRoster / housingPressure test patterns.

import { afterEach, describe, expect, it } from 'vitest'
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
import { getFactionEffects, hasFactionUnlock } from '../ecs/factionEffects'
import { researchCatalog, getResearchSpec } from '../data/research'
import { FACTION_STAT_IDS, type FactionStatId } from '../stats/factionSchema'
import { getStat } from '../stats/sheet'

const TILE = worldConfig.tilePx

// Koota caps live worlds at 16 per process; destroy after each test so the
// per-catalog-row suites can grow past that bound (same pattern as
// aeClinic.test.ts).
const createdWorlds: ReturnType<typeof createWorld>[] = []
afterEach(() => {
  while (createdWorlds.length) createdWorlds.pop()!.destroy()
})

function makeWorld() {
  const world = createWorld()
  createdWorlds.push(world)
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
    // Derive expectations from the catalog so authoring passes don't
    // invalidate this test: rows with no prereqs are available (minus the
    // queued one); rows with unmet prereqs are locked with the gate named.
    const availableIds = researchCatalog
      .filter((s) => s.prereqs.length === 0 && s.id !== 'factory-tier-2')
      .map((s) => s.id).sort()
    expect(view.available.map((r) => r.id).sort()).toEqual(availableIds)
    const gatedIds = researchCatalog
      .filter((s) => s.prereqs.length > 0)
      .map((s) => s.id).sort()
    expect(view.locked.map((r) => r.id).sort()).toEqual(gatedIds)
    for (const row of view.locked) {
      expect(row.missingPrereqIds.length).toBeGreaterThan(0)
    }
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

// ── Phase 5.5.7 catalog authoring pass ──────────────────────────────────

const VALID_CATEGORIES = ['economy', 'military', 'colony', 'quality-of-life']
const VALID_MOD_TYPES = ['flat', 'percentAdd', 'percentMult', 'floor', 'cap']
const FACTION_LEVERS = [
  'revenueMul', 'recruitChanceMul', 'researchSpeedMul', 'loyaltyDriftMul',
] as const

describe('research catalog validation', () => {
  it('holds at least 10 economy / quality-of-life entries', () => {
    const econQol = researchCatalog.filter(
      (s) => s.category === 'economy' || s.category === 'quality-of-life',
    )
    expect(econQol.length).toBeGreaterThanOrEqual(10)
  })

  it('moves every FactionStatSheet lever with at least one research', () => {
    for (const lever of FACTION_LEVERS) {
      const movers = researchCatalog.filter((s) =>
        s.effects.some((e) => e.statId === lever))
      expect(movers.length, `no research moves faction stat '${lever}'`)
        .toBeGreaterThan(0)
    }
  })

  it.each(researchCatalog.map((s) => [s.id, s] as const))(
    'row %s is well-formed',
    (_id, spec) => {
      expect(spec.cost, `cost of ${spec.id} must be a positive number`)
        .toBeGreaterThan(0)
      expect(Number.isFinite(spec.cost)).toBe(true)
      expect(spec.nameZh.trim().length, `${spec.id} needs nameZh`).toBeGreaterThan(0)
      expect(spec.descZh.trim().length, `${spec.id} needs descZh`).toBeGreaterThan(0)
      expect(VALID_CATEGORIES, `${spec.id} category '${spec.category}' unknown`)
        .toContain(spec.category)
      expect(typeof spec.significant).toBe('boolean')
      for (const p of spec.prereqs) {
        expect(getResearchSpec(p), `${spec.id} prereq '${p}' not in catalog`)
          .not.toBeNull()
      }
      for (const e of spec.effects) {
        expect(FACTION_STAT_IDS, `${spec.id} effect statId '${e.statId}' invalid`)
          .toContain(e.statId)
        expect(VALID_MOD_TYPES, `${spec.id} effect type '${e.type}' invalid`)
          .toContain(e.type)
        expect(Number.isFinite(e.value), `${spec.id} effect value must be finite`)
          .toBe(true)
        expect(e.value, `${spec.id} authors a no-op modifier`).not.toBe(0)
      }
      for (const u of spec.unlocks) {
        expect(u.trim().length, `${spec.id} has an empty unlock id`).toBeGreaterThan(0)
      }
    },
  )

  it('has no prereq cycles', () => {
    const visiting = new Set<string>()
    const cleared = new Set<string>()
    const visit = (id: string): void => {
      if (cleared.has(id)) return
      expect(visiting.has(id), `prereq cycle through '${id}'`).toBe(false)
      visiting.add(id)
      for (const p of getResearchSpec(id)?.prereqs ?? []) visit(p)
      visiting.delete(id)
      cleared.add(id)
    }
    for (const s of researchCatalog) visit(s.id)
  })
})

describe('authored rows complete and fold onto the faction', () => {
  it.each(researchCatalog.map((s) => [s.id, s] as const))(
    'completing %s applies its effects and unlocks',
    (_id, spec) => {
      const { world, civ } = makeWorld()
      const player = spawnPlayer(world)
      spawnPlayerOwnedLab(world, player)
      const station = spawnResearcherStation(world)
      spawnSeatedResearcher(world, station)

      // Seed prereqs as already-completed, then park accumulated at cost so
      // the next rollover completes the head regardless of yield.
      const fr0 = civ.get(FactionResearch)!
      civ.set(FactionResearch, { ...fr0, completed: spec.prereqs.slice() })
      expect(enqueueResearch(civ, spec.id)).toBe(true)
      civ.set(FactionResearch, {
        ...civ.get(FactionResearch)!, accumulated: spec.cost,
      })

      const result = researchSystem(world, 1)
      expect(result.completed).toContain(spec.id)
      expect(civ.get(FactionResearch)!.completed).toContain(spec.id)

      for (const u of spec.unlocks) {
        expect(hasFactionUnlock(civ, u), `unlock '${u}' not stamped`).toBe(true)
      }

      if (spec.effects.length === 0) return
      const eff = getFactionEffects(civ).find((e) => e.id === `research:${spec.id}`)
      expect(eff, `FactionEffect research:${spec.id} missing`).toBeDefined()
      expect(eff!.modifiers).toHaveLength(spec.effects.length)

      // Every touched stat must fold to the value the modifier formula
      // predicts from the 1.0 default base:
      //   val = (base + Σflat) × (1 + ΣpctAdd) × Π(1 + pctMult)
      const sheet = civ.get(FactionSheet)!.sheet
      const touched = new Set(spec.effects.map((e) => e.statId))
      for (const statId of touched) {
        let flat = 0; let pctAdd = 0; let pctMul = 1
        for (const e of spec.effects) {
          if (e.statId !== statId) continue
          if (e.type === 'flat') flat += e.value
          else if (e.type === 'percentAdd') pctAdd += e.value
          else if (e.type === 'percentMult') pctMul *= 1 + e.value
        }
        const expected = (1.0 + flat) * (1 + pctAdd) * pctMul
        expect(getStat(sheet, statId as FactionStatId)).toBeCloseTo(expected, 5)
      }
    },
  )
})

describe('prereq gating', () => {
  it('enqueueResearch refuses a prereq-gated row until the prereq completes', () => {
    const { civ } = makeWorld()
    const gated = researchCatalog.find((s) => s.prereqs.length > 0)!
    expect(enqueueResearch(civ, gated.id)).toBe(false)
    const fr = civ.get(FactionResearch)!
    civ.set(FactionResearch, { ...fr, completed: gated.prereqs.slice() })
    expect(enqueueResearch(civ, gated.id)).toBe(true)
  })
})

describe('researchSpeedMul live consumer', () => {
  it('a completed speed research raises the next day\'s yield', () => {
    const { world, civ } = makeWorld()
    const player = spawnPlayer(world)
    spawnPlayerOwnedLab(world, player)
    const station = spawnResearcherStation(world)
    spawnSeatedResearcher(world, station)

    const speedSpec = researchCatalog.find((s) =>
      s.effects.some((e) => e.statId === 'researchSpeedMul' && e.type === 'percentAdd')
      && s.prereqs.length === 0)!
    civ.set(FactionResearch, {
      ...civ.get(FactionResearch)!, queue: [speedSpec.id], accumulated: speedSpec.cost,
    })
    researchSystem(world, 1)
    expect(civ.get(FactionResearch)!.completed).toContain(speedSpec.id)

    // Next rollover: yield must scale by the researched multiplier.
    enqueueResearch(civ, 'factory-tier-2')
    const result = researchSystem(world, 2)
    const pctAdd = speedSpec.effects
      .filter((e) => e.statId === 'researchSpeedMul' && e.type === 'percentAdd')
      .reduce((acc, e) => acc + e.value, 0)
    const expected = researchConfig.baseResearchPerShift * (1 + pctAdd)
    expect(result.progressGenerated).toBeCloseTo(expected, 5)
  })
})
