import json5 from 'json5'
import raw from './scenes.json5?raw'
import type { DoorSide } from './buildingTypes'
import { isShipClassId, getShipClass } from './ships'

export type SceneType = 'micro' | 'macro' | 'ship'

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

export type ProcgenConfig = {
  enabled: boolean
  seed: string
  rect: { x: number; y: number; w: number; h: number }
  roads: RoadGridConfig
  districts: DistrictConfig[]
}

export type FixedBuildingRef = {
  type: string
  tile: { x: number; y: number }
}

export interface MicroSceneConfig {
  id: string
  titleZh: string
  sceneType: 'micro'
  tilesX: number
  tilesY: number
  playerSpawnTile?: { x: number; y: number }
  procgen?: ProcgenConfig
  fixedBuildings?: FixedBuildingRef[]
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

export type SceneConfig = MicroSceneConfig | ShipSceneConfig

interface SceneFile {
  scenes: SceneConfig[]
}

const parsed = json5.parse(raw) as SceneFile

if (parsed.scenes.length === 0) {
  throw new Error('scenes.json5 must declare at least one scene')
}

const seen = new Set<string>()
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

export const maxSceneTilesX = Math.max(...parsed.scenes.map((s) => s.tilesX))
export const maxSceneTilesY = Math.max(...parsed.scenes.map((s) => s.tilesY))
