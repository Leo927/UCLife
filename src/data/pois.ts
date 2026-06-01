import json5 from 'json5'
import raw from './pois.json5?raw'
import { getBody } from './celestialBodies'
import { regionPoiAt } from './scenes'
import { worldConfig } from '../config'

// POI table. Pure data + types — no koota, no derivation. Every POI
// orbits a host body; per-frame world position is derived in the
// engine layer (slice 3) by composing the host body's derived position
// with the POI's own (orbitRadius, orbitPeriodDays, orbitPhase).

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

export interface Poi {
  id: string
  nameZh: string
  shortZh?: string
  type: PoiType
  factionControlPre: FactionKey
  factionControlPost: FactionKey
  services: ServiceKind[]
  encounterPoolId?: string
  // Walkable landing scenes the player can disembark into at this POI.
  // Empty/absent = no walkable scene (in-orbit-only POIs like lunaII). A POI
  // with >1 entry surfaces a disembark picker; one entry auto-picks.
  dockScenes?: string[]
  bodyId: string
  orbitRadius: number
  orbitPeriodDays: number
  orbitPhase: number
  region: string
  takeoffFuelCost: number
  description?: string
}

interface PoiFile {
  pois: Poi[]
}

const parsed = json5.parse(raw) as PoiFile

const byId = new Map<string, Poi>()

for (const p of parsed.pois) {
  if (!p.id || typeof p.id !== 'string') {
    throw new Error('pois.json5: poi missing id')
  }
  if (byId.has(p.id)) {
    throw new Error(`pois.json5: duplicate poi id "${p.id}"`)
  }
  if (!p.bodyId || typeof p.bodyId !== 'string') {
    throw new Error(`pois.json5: poi "${p.id}" missing bodyId`)
  }
  if (!getBody(p.bodyId)) {
    throw new Error(`pois.json5: poi "${p.id}" references unknown bodyId "${p.bodyId}"`)
  }
  if (typeof p.orbitRadius !== 'number' || p.orbitRadius < 0) {
    throw new Error(`pois.json5: poi "${p.id}" needs non-negative orbitRadius`)
  }
  if (typeof p.orbitPeriodDays !== 'number' || p.orbitPeriodDays <= 0) {
    throw new Error(`pois.json5: poi "${p.id}" needs positive orbitPeriodDays`)
  }
  if (typeof p.orbitPhase !== 'number') {
    throw new Error(`pois.json5: poi "${p.id}" needs numeric orbitPhase`)
  }
  if (typeof p.region !== 'string' || p.region.length === 0) {
    throw new Error(`pois.json5: poi "${p.id}" needs non-empty region tag`)
  }
  if (typeof p.takeoffFuelCost !== 'number' || p.takeoffFuelCost < 0) {
    throw new Error(`pois.json5: poi "${p.id}" needs non-negative takeoffFuelCost`)
  }
  if (p.dockScenes !== undefined) {
    if (!Array.isArray(p.dockScenes)) {
      throw new Error(`pois.json5: poi "${p.id}" dockScenes must be an array of scene ids`)
    }
    for (const sid of p.dockScenes) {
      if (typeof sid !== 'string' || sid.length === 0) {
        throw new Error(`pois.json5: poi "${p.id}" dockScenes entries must be non-empty strings`)
      }
    }
  }
  byId.set(p.id, p)
}

export const POIS: readonly Poi[] = parsed.pois

export function getPoi(id: string): Poi | undefined {
  return byId.get(id)
}

// Landing scenes for a POI. Empty array when the POI has no walkable scene.
export function getDockScenes(poiId: string): readonly string[] {
  return byId.get(poiId)?.dockScenes ?? []
}

// First landing scene for a POI, or undefined when none. Single-scene
// callers that don't need the picker use this — the picker uses getDockScenes.
export function getPrimaryDockScene(poiId: string): string | undefined {
  return byId.get(poiId)?.dockScenes?.[0]
}

// Inverse lookup: which POI lists this scene as a landing scene. Returns
// the first match; ambiguity (one scene shared by multiple POIs) is not
// supported. Returns null when no POI advertises this scene.
export function poiIdForScene(sceneId: string): string | null {
  for (const poi of parsed.pois) {
    if (poi.dockScenes?.includes(sceneId)) return poi.id
  }
  return null
}

// POI for a point inside a scene. When the scene tags camera regions with
// poiIds (the surface yard vs the orbital drydock, both in vonBraunCity),
// the containing region's poiId wins; otherwise falls back to the scene's
// single POI. This is the per-building resolution the fleet layer uses so
// two hangars in one world keep distinct POIs.
export function poiIdForSceneAt(sceneId: string, tileX: number, tileY: number): string | null {
  return regionPoiAt(sceneId, tileX, tileY) ?? poiIdForScene(sceneId)
}

// POI a hangar building belongs to, resolved from its centre tile. Region-
// aware so two hangars in one scene (the surface yard + the orbital drydock
// folded into vonBraunCity) keep distinct POIs. `rect` is in pixels (the
// Building trait's units).
export function poiIdForHangar(
  sceneId: string,
  rect: { x: number; y: number; w: number; h: number },
): string | null {
  const tile = worldConfig.tilePx
  return poiIdForSceneAt(sceneId, (rect.x + rect.w / 2) / tile, (rect.y + rect.h / 2) / tile)
}
