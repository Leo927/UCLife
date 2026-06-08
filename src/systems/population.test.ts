import { describe, expect, it, beforeEach } from 'vitest'
import { createWorld } from 'koota'
import { Not } from 'koota'
import { Character, Health, IsPlayer, EntityKey } from '../ecs/traits'
import {
  populationSystem, resetPopulationClock,
  refugeeSpawnRoll, getPopulationState, setPopulationState,
} from './population'
import { refugeesConfig } from '../config'
import type { ReplenishmentConfig } from '../data/scenes'

const CONFIG: ReplenishmentConfig = {
  target: 1,
  arrivalTile: { x: 20, y: 16 },
  regionRect: { x: 0, y: 0, w: 800, h: 600 },
}
const REGION = 'test#0'

function refugeeKeys(world: ReturnType<typeof createWorld>): string[] {
  return [...world.query(Character, Health, EntityKey, Not(IsPlayer))]
    .map((e) => e.get(EntityKey)!.key)
    .filter((k) => k.startsWith('npc-ref-'))
}

describe('populationSystem', () => {
  beforeEach(() => {
    resetPopulationClock()
  })

  it('spawns an NPC when alive count is below target and the throttle has elapsed', () => {
    const world = createWorld()
    const date = new Date(2077, 0, 1, 12, 0, 0)
    // First call seeds the region throttle; second call is past the interval.
    populationSystem(world, date, CONFIG, REGION)
    const laterDate = new Date(date.getTime() + 2 * 60 * 60 * 1000)
    populationSystem(world, laterDate, CONFIG, REGION)

    const npcs = [...world.query(Character, Health, Not(IsPlayer))]
    expect(npcs.length).toBe(1)
  })

  it('does not spawn past the configured target', () => {
    const world = createWorld()
    const date = new Date(2077, 0, 1, 12, 0, 0)
    populationSystem(world, date, CONFIG, REGION)
    populationSystem(world, new Date(date.getTime() + 2 * 60 * 60 * 1000), CONFIG, REGION)
    populationSystem(world, new Date(date.getTime() + 4 * 60 * 60 * 1000), CONFIG, REGION)

    const npcs = [...world.query(Character, Health, Not(IsPlayer))]
    expect(npcs.length).toBe(1)
  })
})

describe('refugeeSpawnRoll', () => {
  beforeEach(() => {
    resetPopulationClock()
  })

  it('fills an opt-in region to the refugee cap and no further', () => {
    const world = createWorld()
    const date = new Date(2077, 0, 1, 12, 0, 0)
    const regions = [{ config: { ...CONFIG, refugeeIntake: true }, key: REGION }]

    let last = refugeeSpawnRoll(world, date, regions)
    for (let i = 0; i < 50 && last.totalSpawned > 0; i++) {
      last = refugeeSpawnRoll(world, date, regions)
    }

    expect(refugeeKeys(world).length).toBe(refugeesConfig.regionRefugeeCap)
    expect(last.totalSpawned).toBe(0)
    expect(last.regions[0].aliveBefore).toBe(refugeesConfig.regionRefugeeCap)
  })

  it('spawns nothing for regions without refugeeIntake', () => {
    const world = createWorld()
    const date = new Date(2077, 0, 1, 12, 0, 0)
    const roll = refugeeSpawnRoll(world, date, [{ config: CONFIG, key: REGION }])

    expect(roll.totalSpawned).toBe(0)
    expect(roll.regions).toEqual([])
    expect(refugeeKeys(world).length).toBe(0)
  })
})

describe('population state round-trip', () => {
  beforeEach(() => {
    resetPopulationClock()
  })

  it('round-trips refugee bookkeeping (counter + last-spawn-day)', () => {
    setPopulationState({
      lastSpawnByRegion: {},
      anonymousCounter: 0,
      immigrantCounter: 7,
      refugeeCounter: 12,
      lastRefugeeSpawnDay: 5,
    })
    const s = getPopulationState()
    expect(s.immigrantCounter).toBe(7)
    expect(s.refugeeCounter).toBe(12)
    expect(s.lastRefugeeSpawnDay).toBe(5)
  })

  it('defaults refugee bookkeeping to 0 for legacy saves missing the fields', () => {
    setPopulationState({ lastSpawnByRegion: {}, anonymousCounter: 0, immigrantCounter: 3 })
    const s = getPopulationState()
    expect(s.refugeeCounter).toBe(0)
    expect(s.lastRefugeeSpawnDay).toBe(0)
  })
})
