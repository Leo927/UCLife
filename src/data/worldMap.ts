import json5 from 'json5'
import raw from './world-map.json5?raw'
import { isSceneId } from './scenes'

export type WorldPlaceKind = 'district' | 'complex' | 'poi'

export interface WorldPlace {
  id: string
  sceneId: string
  nameZh: string
  shortZh: string
  kind: WorldPlaceKind
  tileX: number
  tileY: number
  tileW: number
  tileH: number
  description?: string
}

interface WorldMapFile {
  places: WorldPlace[]
}

const parsed = json5.parse(raw) as WorldMapFile

// Without this check, a typo silently hides the place via the active-scene
// filter instead of failing loud.
for (const p of parsed.places) {
  if (!isSceneId(p.sceneId)) {
    throw new Error(`world-map.json5: place "${p.id}" references unknown sceneId "${p.sceneId}"`)
  }
}

export const worldPlaces: readonly WorldPlace[] = parsed.places

export function getWorldPlace(id: string): WorldPlace | undefined {
  return worldPlaces.find((p) => p.id === id)
}

export function getPlacesInScene(sceneId: string): readonly WorldPlace[] {
  return worldPlaces.filter((p) => p.sceneId === sceneId)
}

export function placeCenterTile(place: WorldPlace): { x: number; y: number } {
  return {
    x: place.tileX + place.tileW / 2,
    y: place.tileY + place.tileH / 2,
  }
}
