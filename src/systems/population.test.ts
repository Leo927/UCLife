import { describe, expect, it, beforeEach } from 'vitest'
import { createWorld } from 'koota'
import { Not } from 'koota'
import { Character, Health, IsPlayer } from '../ecs/traits'
import { populationSystem, resetPopulationClock } from './population'
import type { ReplenishmentConfig } from '../data/scenes'

const CONFIG: ReplenishmentConfig = {
  target: 1,
  arrivalTile: { x: 20, y: 16 },
}

describe('populationSystem', () => {
  beforeEach(() => {
    resetPopulationClock()
  })

  it('spawns an NPC when alive count is below target and the throttle has elapsed', () => {
    const world = createWorld()
    const date = new Date(2077, 0, 1, 12, 0, 0)
    // First call seeds lastSpawnGameMs; second call is past the replenish interval.
    populationSystem(world, date, CONFIG)
    const laterDate = new Date(date.getTime() + 2 * 60 * 60 * 1000)
    populationSystem(world, laterDate, CONFIG)

    const npcs = [...world.query(Character, Health, Not(IsPlayer))]
    expect(npcs.length).toBe(1)
  })

  it('does not spawn past the configured target', () => {
    const world = createWorld()
    const date = new Date(2077, 0, 1, 12, 0, 0)
    populationSystem(world, date, CONFIG)
    populationSystem(world, new Date(date.getTime() + 2 * 60 * 60 * 1000), CONFIG)
    populationSystem(world, new Date(date.getTime() + 4 * 60 * 60 * 1000), CONFIG)

    const npcs = [...world.query(Character, Health, Not(IsPlayer))]
    expect(npcs.length).toBe(1)
  })
})
