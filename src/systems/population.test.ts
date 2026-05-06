import { describe, expect, it, beforeEach } from 'vitest'
import { createWorld } from 'koota'
import { Not } from 'koota'
import { Character, Health, IsPlayer } from '../ecs/traits'
import { populationSystem, resetPopulationClock } from './population'
import { initialSceneId } from '../data/scenes'

const SHIP_SCENE_ID = 'playerShipInterior'

describe('populationSystem', () => {
  beforeEach(() => {
    resetPopulationClock()
  })

  it('does not spawn NPCs when the scene is not the initial city scene', () => {
    const world = createWorld()
    const date = new Date(2077, 0, 1, 12, 0, 0)
    // First call initialises lastSpawnGameMs; second call is past the replenish interval
    populationSystem(world, date, SHIP_SCENE_ID)
    const laterDate = new Date(date.getTime() + 2 * 60 * 60 * 1000)
    populationSystem(world, laterDate, SHIP_SCENE_ID)

    const npcs = [...world.query(Character, Health, Not(IsPlayer))]
    expect(npcs.length).toBe(0)
  })

  it('spawns an NPC when in the initial city scene and population is below target', () => {
    const world = createWorld()
    const date = new Date(2077, 0, 1, 12, 0, 0)
    populationSystem(world, date, initialSceneId)
    const laterDate = new Date(date.getTime() + 2 * 60 * 60 * 1000)
    populationSystem(world, laterDate, initialSceneId)

    const npcs = [...world.query(Character, Health, Not(IsPlayer))]
    expect(npcs.length).toBe(1)
  })
})
