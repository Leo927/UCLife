// Throttled to one arrival per replenishIntervalMin game-minutes so a mass
// die-off refills gradually.

import type { World } from 'koota'
import { Not } from 'koota'
import { Character, Health, IsPlayer, Position, EntityKey } from '../ecs/traits'
import { spawnNPC } from '../character/spawn'
import { populationConfig, refugeesConfig, worldConfig } from '../config'
import type { ReplenishmentConfig } from '../data/scenes'
import { getSimRng } from '../sim/rng'
import { isWartime } from '../sim/warState'
import { emitSim } from '../sim/events'
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

// Phase 7.0.E.1 — wartime refugee intake. Refugees are an alternate arrival
// source that shares the immigrant accounting (same homeRegionByKey, same
// per-region target) but a distinct EntityKey prefix (npc-ref-N), a daily
// cadence instead of the minute throttle, and a lower starting purse. They
// spawn only into regions that opt in via `refugeeIntake` and never push a
// region past its target. lastRefugeeSpawnDay drives the daily cadence; both
// counters persist so reload doesn't reuse keys or re-fire same-day.
let refugeeCounter = 0
let lastRefugeeSpawnDay = 0

export function resetPopulationClock(): void {
  lastSpawnGameMs.clear()
  homeRegionByKey.clear()
  immigrantCounter = 0
  refugeeCounter = 0
  lastRefugeeSpawnDay = 0
  resetNameGen()
}

// Persisted so reload doesn't reuse immigrant keys or reset per-region
// throttles. lastSpawnGameMs is a region-keyed map serialized as a record.
export function getPopulationState(): {
  lastSpawnByRegion: Record<string, number>
  homeRegionByKey: Record<string, string>
  anonymousCounter: number
  immigrantCounter: number
  refugeeCounter: number
  lastRefugeeSpawnDay: number
} {
  return {
    lastSpawnByRegion: Object.fromEntries(lastSpawnGameMs),
    homeRegionByKey: Object.fromEntries(homeRegionByKey),
    anonymousCounter: getAnonymousCounter(),
    immigrantCounter,
    refugeeCounter,
    lastRefugeeSpawnDay,
  }
}

export function setPopulationState(s: {
  lastSpawnByRegion: Record<string, number>
  homeRegionByKey?: Record<string, string>
  anonymousCounter: number
  immigrantCounter: number
  refugeeCounter?: number
  lastRefugeeSpawnDay?: number
}): void {
  lastSpawnGameMs.clear()
  for (const [k, v] of Object.entries(s.lastSpawnByRegion ?? {})) lastSpawnGameMs.set(k, v)
  homeRegionByKey.clear()
  for (const [k, v] of Object.entries(s.homeRegionByKey ?? {})) homeRegionByKey.set(k, v)
  setAnonymousCounter(s.anonymousCounter)
  immigrantCounter = s.immigrantCounter
  refugeeCounter = s.refugeeCounter ?? 0
  lastRefugeeSpawnDay = s.lastRefugeeSpawnDay ?? 0
}

export function getRefugeeBookkeeping(): { refugeeCounter: number; lastRefugeeSpawnDay: number } {
  return { refugeeCounter, lastRefugeeSpawnDay }
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

// ── Wartime refugees (Phase 7.0.E.1) ─────────────────────────────────────────

const REFUGEE_KEY_PREFIX = 'npc-ref-'

// Count the live refugees whose *home* is this region. Mirrors aliveInRegion's
// home-based accounting (not a point-in-rect test) so a refugee that roams out
// of the rect still counts against its home cap — keeping the cap robust if a
// future movement path lets NPCs leave the region. Liveness comes from the
// world scan; home comes from the persisted homeRegionByKey set at spawn. A
// dead/absent refugee's stale map entry is harmless (no matching live entity).
// Refugees are bounded by their own cap (refugeesConfig.regionRefugeeCap)
// rather than the replenishment `target`: a city boots well above that target
// (it is an emergency floor, not the live headcount), so the target leaves no
// headroom. O(N) per roll on the daily tick; negligible against the BT work.
function aliveRefugeesInRegion(world: World, regionKey: string): number {
  let alive = 0
  for (const e of world.query(Character, Health, EntityKey, Not(IsPlayer))) {
    if (e.get(Health)!.dead) continue
    const key = e.get(EntityKey)!.key
    if (!key.startsWith(REFUGEE_KEY_PREFIX)) continue
    if (homeRegionByKey.get(key) === regionKey) alive += 1
  }
  return alive
}

export interface RefugeeRegionResult {
  regionKey: string
  cap: number
  aliveBefore: number
  aliveAfter: number
  spawned: number
  // Tile (tile-space) refugees appeared on — the region's safe arrival tile.
  tile: { x: number; y: number }
  keys: string[]
}

export interface RefugeeRollResult {
  totalSpawned: number
  regions: RefugeeRegionResult[]
}

// Run one refugee intake roll over the supplied regions, ignoring the wartime
// and cadence gates (the daily driver applies those; a debug force-tick drives
// this directly). Each opt-in region below its refugee cap receives up to
// `batchMax` refugees, capped by its remaining headroom so the influx stays
// bounded. Refugees share the immigrant home-region accounting so the ordinary
// replenisher counts them as residents too. Seeded throughout for determinism.
export function refugeeSpawnRoll(
  world: World,
  gameDate: Date,
  regions: { config: ReplenishmentConfig; key: string }[],
): RefugeeRollResult {
  const atMs = gameDate.getTime()
  const rng = getSimRng()
  const cap = refugeesConfig.regionRefugeeCap
  const results: RefugeeRegionResult[] = []
  let totalSpawned = 0

  for (const { config, key: regionKey } of regions) {
    if (!config.refugeeIntake) continue
    const aliveBefore = aliveRefugeesInRegion(world, regionKey)
    const headroom = cap - aliveBefore
    const spawned: string[] = []
    const n = Math.max(0, Math.min(refugeesConfig.batchMax, headroom))
    for (let i = 0; i < n; i++) {
      refugeeCounter += 1
      const key = `${REFUGEE_KEY_PREFIX}${refugeeCounter}`
      homeRegionByKey.set(key, regionKey)
      spawnNPC(world, {
        name: pickFreshName(world),
        color: pickRandomColor(),
        title: '难民',
        x: config.arrivalTile.x * TILE,
        y: config.arrivalTile.y * TILE,
        money: rng.int(refugeesConfig.moneyMin, refugeesConfig.moneyMax),
        key,
      })
      spawned.push(key)
    }
    if (spawned.length > 0) {
      emitSim('log', {
        textZh: `战火蔓延，${spawned.length} 名难民涌入，挤进了廉价旅馆。`,
        atMs,
      })
    }
    totalSpawned += spawned.length
    results.push({
      regionKey,
      cap,
      aliveBefore,
      aliveAfter: aliveRefugeesInRegion(world, regionKey),
      spawned: spawned.length,
      tile: { x: config.arrivalTile.x, y: config.arrivalTile.y },
      keys: spawned,
    })
  }

  return { totalSpawned, regions: results }
}

// Cadence-gated daily entry point (boot/refugeeTick.ts). No-op outside wartime
// or until `spawnCadenceDays` have elapsed since the last roll.
export function refugeeTick(
  world: World,
  gameDate: Date,
  gameDay: number,
  regions: { config: ReplenishmentConfig; key: string }[],
): void {
  if (!isWartime()) return
  if (gameDay - lastRefugeeSpawnDay < refugeesConfig.spawnCadenceDays) return
  lastRefugeeSpawnDay = gameDay
  refugeeSpawnRoll(world, gameDate, regions)
}
