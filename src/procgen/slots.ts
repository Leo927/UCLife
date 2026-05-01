import type { SeededRng } from './rng'
import type { SlotGrid } from '../data/scenes'
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

function shuffle<T>(arr: T[], rng: SeededRng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.intRange(0, i)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function wallLen(rect: { w: number; h: number }, side: DoorSide): number {
  return (side === 'n' || side === 's') ? rect.w : rect.h
}

function pickDoorOffset(lengthPx: number, rng: SeededRng): number {
  const tiles = Math.round(lengthPx / TILE)
  const max = Math.max(1, tiles - 2)
  return rng.intRange(1, max) * TILE
}

// Determine the primary door side for a building type, with zone default as
// fallback. Cell-algorithm buildings have fixed implied door sides that
// cannot be overridden (corridor orientation requires it).
function resolvePrimaryDoor(typeId: string, zoneDoorSide: DoorSide): DoorSide {
  const layout = getBuildingType(typeId).layout
  if (layout.algorithm === 'horizontal_cells') return 's'
  if (layout.algorithm === 'vertical_cells') return 'w'
  if (layout.algorithm === 'open_floor' && layout.primaryDoor) {
    return layout.primaryDoor as DoorSide
  }
  return zoneDoorSide
}

export function generateSlots(grid: SlotGrid, rng: SeededRng): PlacedBuilding[] {
  const result: PlacedBuilding[] = []
  const { rect, cols, gapTiles, rowBands } = grid

  const gapPx = gapTiles * TILE
  const areaW = rect.w * TILE
  const slotW = Math.floor((areaW - gapPx * (cols - 1)) / cols / TILE) * TILE

  let currentY = rect.y * TILE

  for (const band of rowBands) {
    const slotH = band.heightTiles * TILE
    const zoneDoorSide = (band.doorSide ?? 's') as DoorSide

    // Unique draw: shuffle pool, take first min(cols, pool.length) entries.
    const pool = shuffle([...band.types], rng)
    const count = Math.min(cols, pool.length)

    for (let col = 0; col < count; col++) {
      const typeId = pool[col]
      const btype = getBuildingType(typeId)

      // Size building within slot bounds.
      let buildW: number, buildH: number
      if (isFixedSize(btype.size)) {
        buildW = btype.size.w * TILE
        buildH = btype.size.h * TILE
      } else {
        const { minW, maxW, minH, maxH } = btype.size
        const effMaxW = Math.max(minW, Math.min(maxW, Math.round(slotW / TILE)))
        const effMaxH = Math.max(minH, Math.min(maxH, band.heightTiles))
        buildW = rng.intRange(minW, effMaxW) * TILE
        buildH = rng.intRange(minH, effMaxH) * TILE
      }

      const buildRect = {
        x: rect.x * TILE + col * (slotW + gapPx),
        y: currentY,
        w: buildW,
        h: buildH,
      }

      const primarySide = resolvePrimaryDoor(typeId, zoneDoorSide)
      const primaryOffsetPx = pickDoorOffset(wallLen(buildRect, primarySide), rng)
      const primaryDoor: DoorPlacement = { side: primarySide, offsetPx: primaryOffsetPx, widthPx: TILE }

      const extraDoors: DoorPlacement[] = []
      const layout = btype.layout
      if (layout.algorithm === 'open_floor' && layout.extraDoors) {
        for (const ed of layout.extraDoors) {
          const edSide = ed.side as DoorSide
          const edOffset = ed.tiedToPrimary
            ? primaryOffsetPx
            : pickDoorOffset(wallLen(buildRect, edSide), rng)
          extraDoors.push({ side: edSide, offsetPx: edOffset, widthPx: TILE })
        }
      }

      result.push({ typeId, slot: { rect: buildRect, primaryDoor, extraDoors } })
    }

    currentY += slotH + gapPx
  }

  return result
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
