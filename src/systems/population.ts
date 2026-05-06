// Throttled to one arrival per replenishIntervalMin game-minutes so a mass
// die-off refills gradually.

import type { World } from 'koota'
import { Not } from 'koota'
import { Character, Health, IsPlayer } from '../ecs/traits'
import { spawnNPC } from '../character/spawn'
import { populationConfig, worldConfig } from '../config'
import type { ReplenishmentConfig } from '../data/scenes'
import {
  pickFreshName, pickRandomColor,
  getAnonymousCounter, setAnonymousCounter, resetNameGen,
} from '../character/nameGen'

const TILE = worldConfig.tilePx

// loop.ts looks up the active scene's replenishment config and only invokes
// this system when one is declared, so any scene without a `replenishment`
// field (ship interiors, space sectors) is silently skipped. The save format
// keeps immigrantCounter as a single global counter — splitting per-world
// would force a save migration with no correctness benefit, since EntityKeys
// must be unique across the whole save (see character/spawn.ts: spawnNPC
// uses npc-imm-N keys).
let lastSpawnGameMs: number | null = null

// Persisted in saves so reload doesn't reuse keys from prior immigrants.
let immigrantCounter = 0

export function resetPopulationClock(): void {
  lastSpawnGameMs = null
  immigrantCounter = 0
  resetNameGen()
}

export function getPopulationState(): {
  lastSpawnGameMs: number | null
  anonymousCounter: number
  immigrantCounter: number
} {
  return { lastSpawnGameMs, anonymousCounter: getAnonymousCounter(), immigrantCounter }
}

export function setPopulationState(s: {
  lastSpawnGameMs: number | null
  anonymousCounter: number
  immigrantCounter: number
}): void {
  lastSpawnGameMs = s.lastSpawnGameMs
  setAnonymousCounter(s.anonymousCounter)
  immigrantCounter = s.immigrantCounter
}

export function populationSystem(
  world: World,
  gameDate: Date,
  config: ReplenishmentConfig,
): void {
  let alive = 0
  for (const e of world.query(Character, Health, Not(IsPlayer))) {
    if (!e.get(Health)!.dead) alive += 1
  }
  if (alive >= config.target) return

  const nowMs = gameDate.getTime()
  if (lastSpawnGameMs === null) {
    // Wait one full window post-reset so founding NPCs settle first.
    lastSpawnGameMs = nowMs
    return
  }
  const intervalMs = populationConfig.replenishIntervalMin * 60 * 1000
  if (nowMs - lastSpawnGameMs < intervalMs) return

  immigrantCounter += 1
  spawnNPC(world, {
    name: pickFreshName(world),
    color: pickRandomColor(),
    title: '市民',
    x: config.arrivalTile.x * TILE,
    y: config.arrivalTile.y * TILE,
    money: 50 + Math.floor(Math.random() * 100),
    key: `npc-imm-${immigrantCounter}`,
  })
  lastSpawnGameMs = nowMs
}
