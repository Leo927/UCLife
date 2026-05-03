import json5 from 'json5'
import raw from './starmap.json5?raw'
import { SeededRng, WORLD_SEED } from '../procgen'

// Phase 6 Starsector-shape continuous 2D campaign map. Pure data + types —
// no koota, no traits, no runtime state. The encounter engine, captain-burn
// UI, and flight system all read from this module.
//
// `pois` are points in normalized 0..100 space. There is NO graph — travel
// is straight-line, fuel/duration scale with Euclidean distance. Encounters
// trigger at POI arrival (and probabilistically along long burns; that hook
// lives in systems/starmap.ts).
//
// `regions` are thematic encounter pools. The active region for any
// fleet position is the closest region centroid (Voronoi-style soft
// partitioning).
//
// Procedural minor POIs are generated against `WORLD_SEED` at module
// import time so the same run produces the same map. They share the
// schema with major POIs.

export type FactionKey =
  | 'civilian'
  | 'efsf'
  | 'ae'
  | 'zeon'
  | 'neutral'
  | 'pirate'
  | 'none'

export type PoiType =
  | 'colony'
  | 'station'
  | 'asteroid'
  | 'derelict'
  | 'patrol'
  | 'distress'
  | 'mining'
  | 'anomaly'
  | 'shipyard'
  | 'salvage'

export type ServiceKind =
  | 'refuel'
  | 'repair'
  | 'refit'
  | 'hire'
  | 'store'
  | 'news'

export interface MapPos {
  x: number
  y: number
}

export interface Poi {
  id: string
  nameZh: string
  shortZh?: string
  type: PoiType
  factionControlPre: FactionKey
  factionControlPost: FactionKey
  services: ServiceKind[]
  encounterPoolId?: string
  sceneId?: string
  pos: MapPos
  region: string
  description?: string
  // Marks procedurally-generated minor POIs so the UI can dim them and the
  // save layer (if it ever needs to) knows to regenerate from seed.
  procedural?: boolean
}

export interface RegionEncounterEntry {
  templateId: string
  weight: number
  conditions?: { warPhase?: 'pre' | 'post' }
}

export interface Region {
  id: string
  nameZh: string
  centroid: MapPos
  difficultyBand: 'tutorial' | 'low' | 'mid' | 'high' | 'extreme'
  encounterPool: RegionEncounterEntry[]
}

interface StarmapFile {
  regions: Region[]
  pois: Poi[]
}

export interface StarmapData {
  regions: Region[]
  pois: Poi[]
}

const parsed = json5.parse(raw) as StarmapFile

const poiById = new Map<string, Poi>()
const regionById = new Map<string, Region>()

for (const r of parsed.regions) {
  if (regionById.has(r.id)) {
    throw new Error(`starmap.json5: duplicate region id "${r.id}"`)
  }
  if (
    !r.centroid ||
    typeof r.centroid.x !== 'number' ||
    typeof r.centroid.y !== 'number'
  ) {
    throw new Error(`starmap.json5: region "${r.id}" missing centroid {x,y}`)
  }
  regionById.set(r.id, r)
}

function validatePoi(p: Poi, source: string): void {
  if (poiById.has(p.id)) {
    throw new Error(`starmap (${source}): duplicate poi id "${p.id}"`)
  }
  if (
    !p.pos ||
    typeof p.pos.x !== 'number' ||
    typeof p.pos.y !== 'number'
  ) {
    throw new Error(`starmap (${source}): poi "${p.id}" missing pos {x,y}`)
  }
  if (p.pos.x < 0 || p.pos.x > 100 || p.pos.y < 0 || p.pos.y > 100) {
    throw new Error(
      `starmap (${source}): poi "${p.id}" pos out of range — must be 0..100 (got ${p.pos.x}, ${p.pos.y})`,
    )
  }
  if (!regionById.has(p.region)) {
    throw new Error(
      `starmap (${source}): poi "${p.id}" references unknown region "${p.region}"`,
    )
  }
}

for (const p of parsed.pois) {
  validatePoi(p, 'json5')
  poiById.set(p.id, p)
}

// ── Procedural minor POIs ────────────────────────────────────────────
//
// Seeded against WORLD_SEED so the same run produces the same map. We
// scatter a fixed count per region within a bounded radius of the
// region's centroid; types and faction control are drawn from a per-
// region table tuned to the region's narrative feel (Shoal Zone gets
// derelicts/salvage; Outer Belt gets mining/asteroids; etc.). Minor
// POIs never have a sceneId — they're abstract events, not walkable.

interface MinorPoiTemplate {
  type: PoiType
  faction: FactionKey
  weight: number
  nameZh: string
}

const MINOR_TEMPLATES: Record<string, MinorPoiTemplate[]> = {
  lunarSphere: [
    { type: 'patrol', faction: 'efsf', weight: 1, nameZh: '联邦巡逻区' },
    { type: 'mining', faction: 'civilian', weight: 1, nameZh: '月面采矿前哨' },
  ],
  side12cluster: [
    { type: 'patrol', faction: 'efsf', weight: 1, nameZh: '联邦巡逻区' },
    { type: 'salvage', faction: 'none', weight: 1, nameZh: '废料场' },
  ],
  side3approach: [
    { type: 'patrol', faction: 'pirate', weight: 2, nameZh: '走私航道' },
    { type: 'patrol', faction: 'zeon', weight: 1, nameZh: '吉翁巡逻区' },
  ],
  side45graveyard: [
    { type: 'derelict', faction: 'none', weight: 2, nameZh: '漂流货船' },
    { type: 'salvage', faction: 'none', weight: 1, nameZh: '废料场' },
  ],
  shoalZone: [
    { type: 'patrol', faction: 'pirate', weight: 3, nameZh: '海盗截击点' },
    { type: 'derelict', faction: 'none', weight: 2, nameZh: '漂流船' },
    { type: 'salvage', faction: 'none', weight: 2, nameZh: '废料场' },
  ],
  earthOrbit: [
    { type: 'patrol', faction: 'efsf', weight: 1, nameZh: '联邦巡逻区' },
  ],
  outerBelt: [
    { type: 'mining', faction: 'civilian', weight: 2, nameZh: '采矿前哨' },
    { type: 'asteroid', faction: 'none', weight: 1, nameZh: '小行星簇' },
  ],
}

const MINOR_POIS_PER_REGION = 3
const MINOR_POI_RADIUS = 12

function rollWeighted<T extends { weight: number }>(rng: SeededRng, items: T[]): T {
  const total = items.reduce((s, it) => s + it.weight, 0)
  let r = rng.uniform() * total
  for (const it of items) {
    r -= it.weight
    if (r <= 0) return it
  }
  return items[items.length - 1]
}

function generateMinorPois(rng: SeededRng): Poi[] {
  const out: Poi[] = []
  for (const region of parsed.regions) {
    const templates = MINOR_TEMPLATES[region.id]
    if (!templates || templates.length === 0) continue
    for (let i = 0; i < MINOR_POIS_PER_REGION; i++) {
      const tmpl = rollWeighted(rng, templates)
      // Scatter within MINOR_POI_RADIUS of the region centroid, avoiding
      // the inner 2 units (so we don't visually crash into the centroid
      // marker). Clamp to map bounds.
      const angle = rng.uniform() * Math.PI * 2
      const dist = 2 + rng.uniform() * (MINOR_POI_RADIUS - 2)
      const x = Math.max(1, Math.min(99, region.centroid.x + Math.cos(angle) * dist))
      const y = Math.max(1, Math.min(99, region.centroid.y + Math.sin(angle) * dist))
      const id = `${region.id}-${tmpl.type}-${i}`
      const poi: Poi = {
        id,
        nameZh: `${tmpl.nameZh} · ${region.nameZh}`,
        shortZh: tmpl.nameZh,
        type: tmpl.type,
        factionControlPre: tmpl.faction,
        factionControlPost: tmpl.faction,
        services: [],
        pos: { x, y },
        region: region.id,
        procedural: true,
      }
      out.push(poi)
    }
  }
  return out
}

const minorRng = SeededRng.fromString(`${WORLD_SEED}::starmap-minor`)
const minorPois = generateMinorPois(minorRng)
for (const p of minorPois) {
  validatePoi(p, 'procedural')
  poiById.set(p.id, p)
}

const allPois = [...parsed.pois, ...minorPois]

export const STARMAP: StarmapData = {
  regions: parsed.regions,
  pois: allPois,
}

export function getPoi(id: string): Poi | undefined {
  return poiById.get(id)
}

export function getRegion(id: string): Region | undefined {
  return regionById.get(id)
}

// Euclidean distance in normalized map units. Fuel + duration costs scale
// off this; UI uses it for "estimate burn cost" hover tooltips.
export function distanceBetween(fromId: string, toId: string): number {
  const a = poiById.get(fromId)
  const b = poiById.get(toId)
  if (!a || !b) return Infinity
  const dx = b.pos.x - a.pos.x
  const dy = b.pos.y - a.pos.y
  return Math.sqrt(dx * dx + dy * dy)
}

// Returns the region whose centroid is nearest to a given point. Used by
// the encounter generator when the fleet is between POIs.
export function regionAt(pos: MapPos): Region | undefined {
  let best: Region | undefined
  let bestD = Infinity
  for (const r of parsed.regions) {
    const dx = pos.x - r.centroid.x
    const dy = pos.y - r.centroid.y
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = r
    }
  }
  return best
}

// ── Travel cost model ────────────────────────────────────────────────
//
// A burn from POI A to POI B costs:
//   fuel      = ceil(distance / FUEL_PER_UNIT) -- minimum 1
//   supplies  = ceil(distance / SUPPLIES_PER_UNIT) -- minimum 0
//   duration  = floor(distance * MIN_PER_UNIT) game-minutes -- minimum 30
//
// Distance is in normalized 0..100 units; units are deliberately abstract
// so canonical UC distances aren't promised. These constants are tuned so
// a Lunar-sphere hop costs ~1 fuel and ~30-60 minutes, while a long
// outer-belt burn costs 5+ fuel and most of a game-day.

const FUEL_PER_UNIT = 8        // 1 fuel per ~8 normalized units of travel
const SUPPLIES_PER_UNIT = 12   // 1 supply per ~12 normalized units
const MIN_PER_UNIT = 6         // 6 game-minutes per normalized unit
const MIN_DURATION = 30
const MIN_FUEL = 1

export interface BurnCost {
  fuel: number
  supplies: number
  durationMin: number
  distance: number
}

export function burnCost(fromId: string, toId: string): BurnCost {
  const distance = distanceBetween(fromId, toId)
  if (!isFinite(distance)) {
    return { fuel: 0, supplies: 0, durationMin: 0, distance: 0 }
  }
  const fuel = Math.max(MIN_FUEL, Math.ceil(distance / FUEL_PER_UNIT))
  const supplies = Math.ceil(distance / SUPPLIES_PER_UNIT)
  const durationMin = Math.max(MIN_DURATION, Math.floor(distance * MIN_PER_UNIT))
  return { fuel, supplies, durationMin, distance }
}
