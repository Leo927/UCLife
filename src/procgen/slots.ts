// Shared slot/door types + the fixed-building placer.
//
// Procedural building placement now lives in roads.ts + blocks.ts; this
// module only carries the handoff shape consumed by spawn.ts and the
// `placeFixedBuilding` helper for hand-placed structures (e.g. aeComplex).

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

export function placeFixedBuilding(
  typeId: string,
  tile: { x: number; y: number },
  rng: SeededRng,
): PlacedBuilding {
  const btype = getBuildingType(typeId)
  if (!isFixedSize(btype.size)) {
    throw new Error(`Fixed building "${typeId}" must have fixed size { w, h }`)
  }
  if (btype.layout.algorithm !== 'crafted') {
    throw new Error(`Fixed building "${typeId}" must use crafted algorithm`)
  }

  const rect = {
    x: tile.x * TILE,
    y: tile.y * TILE,
    w: btype.size.w * TILE,
    h: btype.size.h * TILE,
  }

  const [primarySpec, ...extraSpecs] = btype.layout.doors

  function resolveOffset(spec: { offsetTiles?: number; offsetMinTiles?: number; offsetMaxTiles?: number }, side: DoorSide): number {
    if (spec.offsetTiles !== undefined) return spec.offsetTiles * TILE
    const tiles = Math.round(wallLen(rect, side) / TILE)
    const min = spec.offsetMinTiles ?? 1
    const max = Math.min(spec.offsetMaxTiles ?? tiles - 2, tiles - 2)
    return rng.intRange(min, Math.max(min, max)) * TILE
  }

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
