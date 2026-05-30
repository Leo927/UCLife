// Throttled to one arrival per replenishIntervalMin game-minutes so a mass
// die-off refills gradually.

import type { World } from 'koota'
import { Not } from 'koota'
import { Character, Health, IsPlayer, Position } from '../ecs/traits'
import { spawnNPC } from '../character/spawn'
import { populationConfig, worldConfig } from '../config'
import type { ReplenishmentConfig } from '../data/scenes'
import { getSimRng } from '../sim/rng'
import {
  pickFreshName, pickRandomColor, resetNameGen,
  getAnonymousCounter, setAnonymousCounter,
} from '../character/nameGen'

const TILE = worldConfig.tilePx

// loop.ts iterates the active scene's replenishment regions and invokes this
// system once per region, so any scene without `replenishments` (ship
// interiors, space sectors) is silently skipped. Each region throttles
// independently — `lastSpawnGameMs` is keyed by region so a chronically
// under-target region can't starve another sharing the world. immigrantCounter
// stays a single global counter because EntityKeys (npc-imm-N) must be unique
// across the whole save.
const lastSpawnGameMs = new Map<string, number>()

let immigrantCounter = 0

export function resetPopulationClock(): void {
  lastSpawnGameMs.clear()
  immigrantCounter = 0
  resetNameGen()
}

// Persisted so reload doesn't reuse immigrant keys or reset per-region
// throttles. lastSpawnGameMs is a region-keyed map serialized as a record.
export function getPopulationState(): {
  lastSpawnByRegion: Record<string, number>
  anonymousCounter: number
  immigrantCounter: number
} {
  return {
    lastSpawnByRegion: Object.fromEntries(lastSpawnGameMs),
    anonymousCounter: getAnonymousCounter(),
    immigrantCounter,
  }
}

export function setPopulationState(s: {
  lastSpawnByRegion: Record<string, number>
  anonymousCounter: number
  immigrantCounter: number
}): void {
  lastSpawnGameMs.clear()
  for (const [k, v] of Object.entries(s.lastSpawnByRegion ?? {})) lastSpawnGameMs.set(k, v)
  setAnonymousCounter(s.anonymousCounter)
  immigrantCounter = s.immigrantCounter
}

// Count alive NPCs whose tile falls inside the region. O(N) per region per
// tick; with ~42 NPCs across two regions this is a few dozen comparisons —
// negligible against the per-tick BT / vitals work.
function aliveInRegion(world: World, region: ReplenishmentConfig): number {
  const r = region.regionRect
  let alive = 0
  for (const e of world.query(Character, Health, Position, Not(IsPlayer))) {
    if (e.get(Health)!.dead) continue
    const p = e.get(Position)!
    const tx = p.x / TILE, ty = p.y / TILE
    if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) alive += 1
  }
  return alive
}

export function populationSystem(
  world: World,
  gameDate: Date,
  config: ReplenishmentConfig,
  regionKey: string,
): void {
  if (aliveInRegion(world, config) >= config.target) return

  const nowMs = gameDate.getTime()
  const last = lastSpawnGameMs.get(regionKey)
  if (last === undefined) {
    // Wait one full window post-reset so founding/seeded NPCs settle first.
    lastSpawnGameMs.set(regionKey, nowMs)
    return
  }
  const intervalMs = populationConfig.replenishIntervalMin * 60 * 1000
  if (nowMs - last < intervalMs) return

  immigrantCounter += 1
  spawnNPC(world, {
    name: pickFreshName(world),
    color: pickRandomColor(),
    title: '市民',
    x: config.arrivalTile.x * TILE,
    y: config.arrivalTile.y * TILE,
    money: getSimRng().int(50, 149),
    key: `npc-imm-${immigrantCounter}`,
  })
  lastSpawnGameMs.set(regionKey, nowMs)
}
