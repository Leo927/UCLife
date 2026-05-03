import json5 from 'json5'
import raw from './celestialBodies.json5?raw'

// Celestial body table. Pure data — no koota, no runtime state. Per-frame
// world position is derived in the engine layer (slice 3) from
// (parent.pos, t, orbitRadius, orbitPeriodDays, orbitPhase). Earth is
// the root with explicit pos and no parent.

export type CelestialKind = 'star' | 'planet' | 'moon' | 'colony' | 'asteroid'

export interface BodyPos {
  x: number
  y: number
}

export interface CelestialBody {
  id: string
  kind: CelestialKind
  nameZh: string
  parentId?: string
  orbitRadius?: number
  orbitPeriodDays?: number
  orbitPhase?: number
  pos?: BodyPos
  bodyRadius: number
  takeoffFuelCost: number
}

interface BodiesFile {
  bodies: CelestialBody[]
}

const parsed = json5.parse(raw) as BodiesFile

const byId = new Map<string, CelestialBody>()

for (const b of parsed.bodies) {
  if (!b.id || typeof b.id !== 'string') {
    throw new Error('celestialBodies.json5: body missing id')
  }
  if (byId.has(b.id)) {
    throw new Error(`celestialBodies.json5: duplicate body id "${b.id}"`)
  }
  if (typeof b.bodyRadius !== 'number' || b.bodyRadius <= 0) {
    throw new Error(`celestialBodies.json5: body "${b.id}" needs positive bodyRadius`)
  }
  if (typeof b.takeoffFuelCost !== 'number' || b.takeoffFuelCost < 0) {
    throw new Error(`celestialBodies.json5: body "${b.id}" needs non-negative takeoffFuelCost`)
  }
  byId.set(b.id, b)
}

for (const b of parsed.bodies) {
  if (b.parentId === undefined) {
    if (!b.pos || typeof b.pos.x !== 'number' || typeof b.pos.y !== 'number') {
      throw new Error(`celestialBodies.json5: root body "${b.id}" missing pos {x,y}`)
    }
  } else {
    if (!byId.has(b.parentId)) {
      throw new Error(
        `celestialBodies.json5: body "${b.id}" references unknown parentId "${b.parentId}"`,
      )
    }
    if (typeof b.orbitRadius !== 'number' || b.orbitRadius <= 0) {
      throw new Error(`celestialBodies.json5: body "${b.id}" needs positive orbitRadius`)
    }
    if (typeof b.orbitPeriodDays !== 'number' || b.orbitPeriodDays <= 0) {
      throw new Error(`celestialBodies.json5: body "${b.id}" needs positive orbitPeriodDays`)
    }
    if (typeof b.orbitPhase !== 'number') {
      throw new Error(`celestialBodies.json5: body "${b.id}" needs numeric orbitPhase`)
    }
  }
}

// Cycle detection — walk parent chain; if we revisit a body before hitting
// a root, the graph has a cycle.
for (const b of parsed.bodies) {
  const seen = new Set<string>()
  let cursor: CelestialBody | undefined = b
  while (cursor) {
    if (seen.has(cursor.id)) {
      throw new Error(`celestialBodies.json5: cycle in parent chain at "${b.id}"`)
    }
    seen.add(cursor.id)
    if (cursor.parentId === undefined) break
    cursor = byId.get(cursor.parentId)
  }
}

if (![...byId.values()].some((b) => b.parentId === undefined)) {
  throw new Error('celestialBodies.json5: no root body (every body has a parent)')
}

export const CELESTIAL_BODIES: readonly CelestialBody[] = parsed.bodies

export function getBody(id: string): CelestialBody | undefined {
  return byId.get(id)
}
