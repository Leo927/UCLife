import { scenes, type WorldPlaceDisplay, type WorldPlaceKind } from './scenes'

export type { WorldPlaceKind } from './scenes'

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

function placeFromDisplay(
  sceneId: string,
  display: WorldPlaceDisplay,
  rect: { x: number; y: number; w: number; h: number },
): WorldPlace {
  return {
    id: display.id,
    sceneId,
    nameZh: display.nameZh,
    shortZh: display.shortZh,
    kind: display.kind,
    description: display.description,
    tileX: rect.x,
    tileY: rect.y,
    tileW: rect.w,
    tileH: rect.h,
  }
}

const places: WorldPlace[] = []

for (const s of scenes) {
  if (s.sceneType !== 'micro') continue
  for (const zone of s.procgenZones ?? []) {
    if (zone.display) {
      places.push(placeFromDisplay(s.id, zone.display, zone.rect))
    }
    const reserved = zone.reservedRects ?? []
    const resolvedReserved = zone.resolvedReservedRects ?? []
    for (let i = 0; i < reserved.length; i++) {
      const r = reserved[i]
      if (!r.display) continue
      const resolved = resolvedReserved[i]
      if (!resolved) continue
      places.push(placeFromDisplay(s.id, r.display, resolved.rect))
    }
  }
  for (const fb of s.fixedBuildings ?? []) {
    if (!fb.display || !fb.resolvedRect) continue
    places.push(placeFromDisplay(s.id, fb.display, fb.resolvedRect))
  }
}

export const worldPlaces: readonly WorldPlace[] = places

export function getPlacesInScene(sceneId: string): readonly WorldPlace[] {
  return worldPlaces.filter((p) => p.sceneId === sceneId)
}
