import { describe, expect, it, beforeEach } from 'vitest'
import { createWorld } from 'koota'
import { Not } from 'koota'
import { Character, Health, IsPlayer } from '../ecs/traits'
import { populationSystem, resetPopulationClock } from './population'
import type { ReplenishmentConfig } from '../data/scenes'

const CONFIG: ReplenishmentConfig = {
  target: 1,
  arrivalTile: { x: 20, y: 16 },
  regionRect: { x: 0, y: 0, w: 800, h: 600 },
}
const REGION = 'test#0'

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
