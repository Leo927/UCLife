import json5 from 'json5'
import raw from './scenes.json5?raw'
import type { DoorSide } from './buildingTypes'
import { getBuildingType, isFixedSize } from './buildingTypes'
import { isShipClassId, getShipClass } from './ship-classes'

export type SceneType = 'micro' | 'macro' | 'ship' | 'space'

export type RoadGridConfig = {
  avenueSpacingTiles: { min: number; max: number }
  streetSpacingTiles: { min: number; max: number }
  avenueWidthTiles: number
  streetWidthTiles: number
  alleyChance: number
  alleyWidthTiles: number
  alleyMinBlockTiles: number
}

// One building-type entry inside a district pool. `min`/`max` cap how
// many of this type are placed in the district. Defaults: min 0, max
// unbounded (so omitting both means "place freely as space allows").
export type DistrictTypeEntry = {
  id: string
  min?: number
  max?: number
}

// Rect in tile-space, relative to the procgen rect's origin.
export type DistrictConfig = {
  id: string
  rect: { x: number; y: number; w: number; h: number }
  types: DistrictTypeEntry[]
  buildingsPerBlockMax?: number
}

// Player-facing marker metadata for the world map. Attaching it to a
// procgen zone or a reservedRect lets MapPanel/TransitMap derive the
// place list straight from scenes.json5 — no second source of truth.
//   id          — stable id; cross-references survive renames.
//   nameZh/shortZh — full and abbreviated player-facing labels.
//   description — long-form blurb shown in the map panel place list.
//   kind        — drives marker color / visibility tier.
export type WorldPlaceKind = 'district' | 'complex' | 'poi'
export type WorldPlaceDisplay = {
  id: string
  nameZh: string
  shortZh: string
  description?: string
  kind: WorldPlaceKind
}

// Hand-placed building that lives *inside* a procgen zone instead of
// outside it. The road grid forces avenues at the rect's east/west edges
// and streets at its north/south edges, so the rect emerges as a single
// uncarved super-block; spawn drops the building into that block.
//
// Use this for any fixed-size building that needs to sit on a footprint
// larger than the zone's street-block envelope — the crafted AE Complex
// uses it for visual integration; procgen layouts (airport, transit,
// open_floor, park) use it to host facilities too big for the
// per-block assigner. For non-crafted layouts the `door` field supplies
// the primary-door side + offset that crafted layouts get from
// `layout.doors`.
export type ReservedDoorSpec = {
  side: DoorSide
  offsetTiles?: number
}
export type ReservedRectRef = {
  buildingType: string
  tile: { x: number; y: number }
  door?: ReservedDoorSpec
  display?: WorldPlaceDisplay
}

// Validated form: tile-space rect with the building's size baked in.
// `door` is preserved so spawn-time can hand it to placeFixedBuilding for
// non-crafted layouts; crafted layouts ignore it.
export type ResolvedReservedRect = {
  typeId: string
  rect: { x: number; y: number; w: number; h: number }
  door?: ReservedDoorSpec
}

export type ProcgenConfig = {
  enabled: boolean
  seed: string
  rect: { x: number; y: number; w: number; h: number }
  roads: RoadGridConfig
  districts: DistrictConfig[]
  reservedRects?: ReservedRectRef[]
  // Resolved at scene load time. Same data as `reservedRects` but with
  // building dimensions looked up from buildingTypes, so procgen consumers
  // never have to re-resolve.
  resolvedReservedRects?: ResolvedReservedRect[]
  // Optional zone-level marker for the player-facing map. Marker rect = the
  // zone's procgen rect, so geometry stays in lockstep with road generation.
  display?: WorldPlaceDisplay
}

// `door` is required for non-crafted layouts (open_floor, etc.) since
// those don't carry their own door list; crafted layouts ignore it.
// `display` attaches a world-map marker covering the building footprint
// — same shape as a reservedRect's display.
// `resolvedRect` is filled in at load time so worldMap.ts can render the
// marker without re-resolving against buildingTypes.
export type FixedBuildingRef = {
  type: string
  tile: { x: number; y: number }
  door?: ReservedDoorSpec
  display?: WorldPlaceDisplay
  resolvedRect?: { x: number; y: number; w: number; h: number }
}

export type TileRect = { x: number; y: number; w: number; h: number }

// Per-region NPC replenishment. A scene may declare several regions; each
// maintains its own alive-NPC target counted only within `regionRect`, so
// spatially-disconnected regions (e.g. the hidden drydock inside vonBraunCity)
// top up independently of the rest of the world.
//   target      — alive-NPC count to maintain (excluding the player).
//   arrivalTile — where each new immigrant spawns, in this scene's tile-space.
//                 Must be a walkable tile inside `regionRect`.
//   regionRect  — tile-space bounds the alive-count is taken over.
//   refugeeIntake — opt in this region to wartime refugee arrivals (Phase
//                 7.0.E.1). Refugees spawn at `arrivalTile` (a safe walkable
//                 tile by construction, never a locked cell) and fill toward
//                 `target` like immigrants. Omit/false to take no refugees
//                 (e.g. the sealed drydock crew region).
// Throttle (replenishIntervalMin) stays global — see config/population.json5.
export interface ReplenishmentConfig {
  target: number
  arrivalTile: { x: number; y: number }
  regionRect: TileRect
  refugeeIntake?: boolean
}

// Camera clamp region (tile-space). The camera clamps to whichever region
// contains the player, so spatially-disconnected regions never bleed into one
// another's view. `hidden` regions are additionally dropped from the world map.
// `poiId` ties the region to a space-campaign POI so that two hangars sharing
// one scene (the surface yard + the orbital drydock folded into vonBraunCity)
// keep distinct fleet-POI identities — see pois.ts `poiIdForSceneAt`.
export interface CameraRegionConfig {
  rect: TileRect
  hidden?: boolean
  poiId?: string
}

export interface MicroSceneConfig {
  id: string
  titleZh: string
  sceneType: 'micro'
  tilesX: number
  tilesY: number
  playerSpawnTile?: { x: number; y: number }
  // One or more procgen zones. Each zone is its own road network + district
  // pool, seeded independently. Use multiple zones for spatially separated
  // sectors (e.g. a downtown plus an industrial district across the map).
  // Zone rects must not overlap each other or any fixedBuilding rect — the
  // road carver still doesn't know about holes.
  procgenZones?: ProcgenConfig[]
  fixedBuildings?: FixedBuildingRef[]
  // Hand-authored static walls (tile-space). Used to seal off a region into
  // its own walkable pathfinding component (the drydock hull ring) without a
  // building footprint. Spawned as plain Wall entities at bootstrap.
  walls?: TileRect[]
  cameraRegions?: CameraRegionConfig[]
  replenishments?: ReplenishmentConfig[]
}

export interface ShipSceneConfig {
  id: string
  titleZh: string
  sceneType: 'ship'
  shipClassId: string
  tilesX: number
  tilesY: number
  playerSpawnRoomId: string
}

// Open-space sector scene (Phase 6.0). No procgen, no walls, no
// fixedBuildings; bodies + POIs come from celestialBodies.json5 / pois.json5
// and are spawned by sim/spaceBootstrap.ts.
export interface SpaceSceneConfig {
  id: string
  titleZh: string
  sceneType: 'space'
  tilesX: number
  tilesY: number
}

export type SceneConfig = MicroSceneConfig | ShipSceneConfig | SpaceSceneConfig

interface SceneFile {
  scenes: SceneConfig[]
}

const parsed = json5.parse(raw) as SceneFile

if (parsed.scenes.length === 0) {
  throw new Error('scenes.json5 must declare at least one scene')
}

const seen = new Set<string>()
const placeIds = new Set<string>()
for (const s of parsed.scenes) {
  if (seen.has(s.id)) throw new Error(`scenes.json5: duplicate scene id "${s.id}"`)
  seen.add(s.id)
  if (s.tilesX <= 0 || s.tilesY <= 0) {
    throw new Error(`scenes.json5: scene "${s.id}" has non-positive dimensions`)
  }
  if (s.sceneType === 'ship') {
    if (!isShipClassId(s.shipClassId)) {
      throw new Error(
        `scenes.json5: scene "${s.id}" references unknown shipClassId "${s.shipClassId}"`,
      )
    }
    const cls = getShipClass(s.shipClassId)
    if (!cls.rooms.some((r) => r.id === s.playerSpawnRoomId)) {
      throw new Error(
        `scenes.json5: scene "${s.id}" playerSpawnRoomId "${s.playerSpawnRoomId}" is not a room of ship class "${s.shipClassId}"`,
      )
    }
  }
  if (s.sceneType === 'micro' && s.procgenZones) {
    for (const zone of s.procgenZones) {
      if (zone.display) {
        const id = zone.display.id
        if (placeIds.has(id)) {
          throw new Error(`scenes.json5: duplicate world-place id "${id}"`)
        }
        placeIds.add(id)
      }
      if (!zone.reservedRects) continue
      const aw = zone.roads.avenueWidthTiles
      const sw = zone.roads.streetWidthTiles
      const resolved: ResolvedReservedRect[] = []
      for (const r of zone.reservedRects) {
        const btype = getBuildingType(r.buildingType)
        if (!isFixedSize(btype.size)) {
          throw new Error(
            `scenes.json5: scene "${s.id}" reservedRect "${r.buildingType}" must be a fixed-size building`,
          )
        }
        // Crafted layouts carry their own door list. Every other layout
        // needs a primary-door spec attached to the reservedRect entry.
        if (btype.layout.algorithm !== 'crafted' && !r.door) {
          throw new Error(
            `scenes.json5: scene "${s.id}" reservedRect "${r.buildingType}" (layout=${btype.layout.algorithm}) needs a door spec`,
          )
        }
        const rect = { x: r.tile.x, y: r.tile.y, w: btype.size.w, h: btype.size.h }
        // Need room for forced avenues at east/west edges and streets at
        // north/south edges, so the rect can't touch the zone boundary.
        if (rect.x - aw < zone.rect.x || rect.x + rect.w + aw > zone.rect.x + zone.rect.w) {
          throw new Error(
            `scenes.json5: scene "${s.id}" reservedRect "${r.buildingType}" needs ${aw} tile(s) of horizontal buffer inside zone rect`,
          )
        }
        if (rect.y - sw < zone.rect.y || rect.y + rect.h + sw > zone.rect.y + zone.rect.h) {
          throw new Error(
            `scenes.json5: scene "${s.id}" reservedRect "${r.buildingType}" needs ${sw} tile(s) of vertical buffer inside zone rect`,
          )
        }
        resolved.push({ typeId: r.buildingType, rect, door: r.door })
        if (r.display) {
          const id = r.display.id
          if (placeIds.has(id)) {
            throw new Error(`scenes.json5: duplicate world-place id "${id}"`)
          }
          placeIds.add(id)
        }
      }
      zone.resolvedReservedRects = resolved
    }
  }
  if (s.sceneType === 'micro' && s.fixedBuildings) {
    for (const fb of s.fixedBuildings) {
      const btype = getBuildingType(fb.type)
      if (!isFixedSize(btype.size)) {
        throw new Error(
          `scenes.json5: scene "${s.id}" fixedBuilding "${fb.type}" must be a fixed-size building`,
        )
      }
      if (btype.layout.algorithm !== 'crafted' && !fb.door) {
        throw new Error(
          `scenes.json5: scene "${s.id}" fixedBuilding "${fb.type}" (layout=${btype.layout.algorithm}) needs a door spec`,
        )
      }
      fb.resolvedRect = { x: fb.tile.x, y: fb.tile.y, w: btype.size.w, h: btype.size.h }
      if (fb.display) {
        const id = fb.display.id
        if (placeIds.has(id)) {
          throw new Error(`scenes.json5: duplicate world-place id "${id}"`)
        }
        placeIds.add(id)
      }
    }
  }
  if (s.sceneType === 'micro' && s.replenishments) {
    for (let ri = 0; ri < s.replenishments.length; ri++) {
      const r = s.replenishments[ri]
      if (!Number.isFinite(r.target) || r.target < 0) {
        throw new Error(
          `scenes.json5: scene "${s.id}" replenishments[${ri}].target must be a non-negative number`,
        )
      }
      const t = r.arrivalTile
      if (t.x < 0 || t.y < 0 || t.x >= s.tilesX || t.y >= s.tilesY) {
        throw new Error(
          `scenes.json5: scene "${s.id}" replenishments[${ri}].arrivalTile (${t.x},${t.y}) is outside the ${s.tilesX}x${s.tilesY} envelope`,
        )
      }
    }
  }
}

// Suppress "unused" for DoorSide; it's re-exported for downstream consumers.
export type { DoorSide }

export const scenes: readonly SceneConfig[] = parsed.scenes
export const sceneIds: readonly string[] = parsed.scenes.map((s) => s.id)

export const initialSceneId: string = parsed.scenes[0].id

const byId = new Map<string, SceneConfig>(parsed.scenes.map((s) => [s.id, s]))

export function getSceneConfig(id: string): SceneConfig {
  const c = byId.get(id)
  if (!c) throw new Error(`Unknown scene id: ${id}`)
  return c
}

export function isSceneId(id: string): boolean {
  return byId.has(id)
}

function pointInRect(tileX: number, tileY: number, r: TileRect): boolean {
  return tileX >= r.x && tileX < r.x + r.w && tileY >= r.y && tileY < r.y + r.h
}

// Camera regions for a micro scene (empty for non-micro / scenes that don't
// declare any). The camera clamps to whichever region contains the player.
export function getCameraRegions(id: string): readonly CameraRegionConfig[] {
  const c = byId.get(id)
  if (!c || c.sceneType !== 'micro') return []
  return c.cameraRegions ?? []
}

// True when (tileX, tileY) falls inside a `hidden` camera region of the scene
// — used to drop drydock buildings from the world map and to tag the
// drydock-end lift kiosk as the orbital (fare-free-to-leave) endpoint.
export function isInHiddenRegion(id: string, tileX: number, tileY: number): boolean {
  for (const region of getCameraRegions(id)) {
    if (region.hidden && pointInRect(tileX, tileY, region.rect)) return true
  }
  return false
}

// The camera-clamp rect (tile-space) containing (tileX, tileY), or null when
// the scene declares no regions / the point is in none — the caller then
// clamps to the full scene envelope. Lets the camera stay inside the player's
// current region so spatially-disconnected regions never share a frame.
export function cameraRegionAt(id: string, tileX: number, tileY: number): TileRect | null {
  for (const region of getCameraRegions(id)) {
    if (pointInRect(tileX, tileY, region.rect)) return region.rect
  }
  return null
}

// The poiId of the camera region containing (tileX, tileY), or null. Lets the
// fleet layer resolve a hangar's POI per-building when several regions (hence
// several POIs) share one scene. pois.ts wraps this with a single-POI fallback.
export function regionPoiAt(id: string, tileX: number, tileY: number): string | null {
  for (const region of getCameraRegions(id)) {
    if (region.poiId && pointInRect(tileX, tileY, region.rect)) return region.poiId
  }
  return null
}

// The surface (visible) and orbital (hidden) region poiIds of a scene, for the
// starmap to draw the elevator line of a same-world lift between its two POIs.
export function regionPoiIds(id: string): { visible: string | null; hidden: string | null } {
  let visible: string | null = null
  let hidden: string | null = null
  for (const region of getCameraRegions(id)) {
    if (!region.poiId) continue
    if (region.hidden) { hidden ??= region.poiId }
    else { visible ??= region.poiId }
  }
  return { visible, hidden }
}

// Pathfinding (src/systems/pathfinding.ts) and HPA* (src/systems/hpa.ts)
// pre-allocate a half-tile grid buffer sized to these maxes. The
// spaceCampaign sector is 30000 × 24000 tiles — 1500× larger than any city
// scene — and would blow the buffer. Space scenes have no pathfinding
// (continuous physics, no walls), so excluding them is safe.
export const maxSceneTilesX = Math.max(
  ...parsed.scenes.filter((s) => s.sceneType !== 'space').map((s) => s.tilesX),
)
export const maxSceneTilesY = Math.max(
  ...parsed.scenes.filter((s) => s.sceneType !== 'space').map((s) => s.tilesY),
)
