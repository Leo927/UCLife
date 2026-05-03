import json5 from 'json5'
import raw from './pois.json5?raw'
import { getBody } from './celestialBodies'

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
  sceneId?: string
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
  byId.set(p.id, p)
}

export const POIS: readonly Poi[] = parsed.pois

export function getPoi(id: string): Poi | undefined {
  return byId.get(id)
}
