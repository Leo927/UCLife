import json5 from 'json5'
import raw from './scenes.json5?raw'
import type { DoorSide } from './buildingTypes'

export type SceneType = 'micro' | 'macro'

export type RowBand = {
  heightTiles: number
  types: string[]
  doorSide?: DoorSide
}

export type SlotGrid = {
  rect: { x: number; y: number; w: number; h: number }
  cols: number
  gapTiles: number
  rowBands: RowBand[]
}

export type ProcgenConfig = {
  seed: string
  slotGrid: SlotGrid
}

export type FixedBuildingRef = {
  type: string
  tile: { x: number; y: number }
}

export type SurvivalSourceRef = {
  type: 'tap' | 'scavenge' | 'bench'
  tile: { x: number; y: number }
}

export interface SceneConfig {
  id: string
  titleZh: string
  sceneType: SceneType
  tilesX: number
  tilesY: number
  playerSpawnTile?: { x: number; y: number }
  procgen?: ProcgenConfig
  fixedBuildings?: FixedBuildingRef[]
  survivalSources?: SurvivalSourceRef[]
}

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
}

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
