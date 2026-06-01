// Throttled to one arrival per replenishIntervalMin game-minutes so a mass
// die-off refills gradually.

import type { World } from 'koota'
import { Not } from 'koota'
import { Character, Health, IsPlayer, Position, EntityKey } from '../ecs/traits'
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

// Each NPC's home region, keyed by its (persisted) EntityKey. A region's
// replenisher maintains the count of its *residents*, not whoever stands in
// its rect this instant — otherwise a sealed region whose crew can foot-route
// out (the orbital drydock, reachable from the city only by the lift portal)
// empties as they leave and the replenisher spawns endless replacements that
// also leave. Home is fixed the first time the replenisher sees an NPC inside
// a region rect (founding NPCs on the first tick, immigrants at spawn) and
// never changes as they roam.
const homeRegionByKey = new Map<string, string>()

let immigrantCounter = 0

export function resetPopulationClock(): void {
  lastSpawnGameMs.clear()
  homeRegionByKey.clear()
  immigrantCounter = 0
  resetNameGen()
}

// Persisted so reload doesn't reuse immigrant keys or reset per-region
// throttles. lastSpawnGameMs is a region-keyed map serialized as a record.
export function getPopulationState(): {
  lastSpawnByRegion: Record<string, number>
  homeRegionByKey: Record<string, string>
  anonymousCounter: number
  immigrantCounter: number
} {
  return {
    lastSpawnByRegion: Object.fromEntries(lastSpawnGameMs),
    homeRegionByKey: Object.fromEntries(homeRegionByKey),
    anonymousCounter: getAnonymousCounter(),
    immigrantCounter,
  }
}

export function setPopulationState(s: {
  lastSpawnByRegion: Record<string, number>
  homeRegionByKey?: Record<string, string>
  anonymousCounter: number
  immigrantCounter: number
}): void {
  lastSpawnGameMs.clear()
  for (const [k, v] of Object.entries(s.lastSpawnByRegion ?? {})) lastSpawnGameMs.set(k, v)
  homeRegionByKey.clear()
  for (const [k, v] of Object.entries(s.homeRegionByKey ?? {})) homeRegionByKey.set(k, v)
  setAnonymousCounter(s.anonymousCounter)
  immigrantCounter = s.immigrantCounter
}

function inRect(p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }): boolean {
  const tx = p.x / TILE, ty = p.y / TILE
  return tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h
}

// Count alive NPCs whose *home* is this region. Roaming (including a foot-route
// across the lift portal) never changes home, so a sealed region's resident
// count is stable. An untagged NPC standing in this region's rect is adopted
// here on first sight (founding NPCs, before they roam). O(N) per region per
// tick; a few dozen comparisons, negligible against the BT / vitals work.
function aliveInRegion(world: World, region: ReplenishmentConfig, regionKey: string): number {
  let alive = 0
  for (const e of world.query(Character, Health, Position, EntityKey, Not(IsPlayer))) {
    if (e.get(Health)!.dead) continue
    const key = e.get(EntityKey)!.key
    let home = homeRegionByKey.get(key)
    if (home === undefined && inRect(e.get(Position)!, region.regionRect)) {
      homeRegionByKey.set(key, regionKey)
      home = regionKey
    }
    if (home === regionKey) alive += 1
  }
  return alive
}

export function populationSystem(
  world: World,
  gameDate: Date,
  config: ReplenishmentConfig,
  regionKey: string,
): void {
  if (aliveInRegion(world, config, regionKey) >= config.target) return

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
  const key = `npc-imm-${immigrantCounter}`
  homeRegionByKey.set(key, regionKey)
  spawnNPC(world, {
    name: pickFreshName(world),
    color: pickRandomColor(),
    title: '市民',
    x: config.arrivalTile.x * TILE,
    y: config.arrivalTile.y * TILE,
    money: getSimRng().int(50, 149),
    key,
  })
  lastSpawnGameMs.set(regionKey, nowMs)
}
