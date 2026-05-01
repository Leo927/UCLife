import json5 from 'json5'
import raw from './scenes.json5?raw'

export type SceneBootstrap = 'cityProcgen' | 'stub'

export interface SceneConfig {
  id: string
  titleZh: string
  tilesX: number
  tilesY: number
  bootstrap: SceneBootstrap
  playerSpawnTile?: { x: number; y: number }
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

// First scene in declaration order is the boot scene; others are reached
// via flight.
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

// Pathfinding/HPA scratch buffers are sized to the max envelope so a scene
// swap is a cache repoint, not a realloc.
export const maxSceneTilesX = Math.max(...parsed.scenes.map((s) => s.tilesX))
export const maxSceneTilesY = Math.max(...parsed.scenes.map((s) => s.tilesY))
