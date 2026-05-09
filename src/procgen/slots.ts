// Shared slot/door types + the fixed-building placer.
//
// Procedural building placement now lives in roads.ts + blocks.ts; this
// module only carries the handoff shape consumed by spawn.ts and the
// `placeFixedBuilding` helper for hand-placed structures (e.g. aeComplex,
// the airport reservedRect).

import type { SeededRng } from './rng'
import { getBuildingType, isFixedSize } from '../data/buildingTypes'
import { worldConfig } from '../config'

const TILE = worldConfig.tilePx

export type DoorSide = 'n' | 's' | 'e' | 'w'

export type DoorPlacement = {
  side: DoorSide
  offsetPx: number
  widthPx: number
}

export type PlacedSlot = {
  rect: { x: number; y: number; w: number; h: number }
  primaryDoor: DoorPlacement
  extraDoors: DoorPlacement[]
}

export type PlacedBuilding = {
  typeId: string
  slot: PlacedSlot
}

function wallLen(rect: { w: number; h: number }, side: DoorSide): number {
  return (side === 'n' || side === 's') ? rect.w : rect.h
}

export type ReservedDoorOverride = {
  side: DoorSide
  offsetTiles?: number
}

// Place a fixed-size building. `crafted` layouts pull their door list from
// `layout.doors`; non-crafted fixed-size layouts (airport, transit,
// open_floor, park) MUST pass a `doorOverride` because their layout shape
// has no door field.
export function placeFixedBuilding(
  typeId: string,
  tile: { x: number; y: number },
  rng: SeededRng,
  doorOverride?: ReservedDoorOverride,
): PlacedBuilding {
  const btype = getBuildingType(typeId)
  if (!isFixedSize(btype.size)) {
    throw new Error(`Fixed building "${typeId}" must have fixed size { w, h }`)
  }

  const rect = {
    x: tile.x * TILE,
    y: tile.y * TILE,
    w: btype.size.w * TILE,
    h: btype.size.h * TILE,
  }

  function resolveOffset(spec: { offsetTiles?: number; offsetMinTiles?: number; offsetMaxTiles?: number }, side: DoorSide): number {
    if (spec.offsetTiles !== undefined) return spec.offsetTiles * TILE
    const tiles = Math.round(wallLen(rect, side) / TILE)
    const min = spec.offsetMinTiles ?? 1
    const max = Math.min(spec.offsetMaxTiles ?? tiles - 2, tiles - 2)
    return rng.intRange(min, Math.max(min, max)) * TILE
  }

  if (btype.layout.algorithm === 'crafted') {
    const [primarySpec, ...extraSpecs] = btype.layout.doors
    const primarySide = primarySpec.side as DoorSide
    const primaryDoor: DoorPlacement = {
      side: primarySide,
      offsetPx: resolveOffset(primarySpec, primarySide),
      widthPx: TILE,
    }
    const extraDoors: DoorPlacement[] = extraSpecs.map((spec) => {
      const side = spec.side as DoorSide
      return { side, offsetPx: resolveOffset(spec, side), widthPx: TILE }
    })
    return { typeId, slot: { rect, primaryDoor, extraDoors } }
  }

  if (!doorOverride) {
    throw new Error(
      `Fixed building "${typeId}" (layout=${btype.layout.algorithm}) needs a door override`,
    )
  }
  const primaryDoor: DoorPlacement = {
    side: doorOverride.side,
    offsetPx: resolveOffset({ offsetTiles: doorOverride.offsetTiles }, doorOverride.side),
    widthPx: TILE,
  }
  return { typeId, slot: { rect, primaryDoor, extraDoors: [] } }
}
