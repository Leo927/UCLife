import type { SeededRng } from './rng'

export type Rect = { x: number; y: number; w: number; h: number }
export type Vec2 = { x: number; y: number }

const TILE = 32
const WALL_T = 6

// Inner margin keeping the bed visual clear of cell walls and the cell door.
const BED_MARGIN_PX = 24

export type GeneratedCell = {
  rect: Rect
  bedPos: Vec2
  doorRect: Rect
  doorOrient: 'h' | 'v'
}

export type GeneratedCellLayout = {
  cells: GeneratedCell[]
  // Interior cell partitions only — building exterior walls excluded.
  walls: Rect[]
  corridor: Rect
}

// Distribute `total` units across `slots` slots, each receiving at least
// `minEach`. Extras allocated via the RNG. Throws if minimums don't fit.
function distribute(total: number, slots: number, minEach: number, rng: SeededRng): number[] {
  if (slots * minEach > total) {
    throw new Error(`distribute: ${slots} slots × ${minEach} min > total ${total}`)
  }
  const out = new Array<number>(slots).fill(minEach)
  let remaining = total - slots * minEach
  while (remaining > 0) {
    out[rng.intRange(0, slots - 1)]++
    remaining--
  }
  return out
}

// Falls back to the midpoint when no tile-aligned value fits in [lo, hi].
function pickTileAligned(lo: number, hi: number, rng: SeededRng): number {
  const minTile = Math.ceil(lo / TILE)
  const maxTile = Math.floor(hi / TILE)
  if (maxTile < minTile) return Math.round((lo + hi) / 2 / TILE) * TILE
  return rng.intRange(minTile, maxTile) * TILE
}

// 公寓-style: cells along the north, corridor along the south, doors south.
export function generateApartmentCells(
  building: Rect,
  cellCount: number,
  rng: SeededRng,
): GeneratedCellLayout {
  // Cell area ≥ ~3 tiles tall for a bed; corridor ≥ ~1.2 tiles to walk.
  const minCellH = TILE * 3
  const minCorridorH = Math.round(TILE * 1.2)
  const minPartY = building.y + minCellH
  const maxPartY = building.y + building.h - WALL_T - minCorridorH
  const partitionY = pickTileAligned(minPartY, maxPartY, rng)

  // Min cell width = 2 tiles (bed + walking room).
  const buildingTilesW = Math.round(building.w / TILE)
  const widths = distribute(buildingTilesW, cellCount, 2, rng)

  const cells: GeneratedCell[] = []
  const walls: Rect[] = []
  let cursor = building.x

  for (let i = 0; i < cellCount; i++) {
    const w = widths[i] * TILE
    const cellRect: Rect = {
      x: cursor,
      y: building.y,
      w,
      h: partitionY - building.y,
    }

    if (i > 0) {
      walls.push({ x: cursor, y: building.y, w: WALL_T, h: partitionY - building.y })
    }

    const doorMinX = cursor + TILE / 2
    const doorMaxX = cursor + w - TILE - TILE / 2
    const doorX = pickTileAligned(doorMinX, doorMaxX, rng)

    const bedMinY = building.y + BED_MARGIN_PX
    const bedMaxY = partitionY - BED_MARGIN_PX
    const bedY = bedMinY + rng.uniform() * (bedMaxY - bedMinY)
    const bedMinX = cursor + BED_MARGIN_PX
    const bedMaxX = cursor + w - BED_MARGIN_PX
    let bedX = bedMinX + rng.uniform() * (bedMaxX - bedMinX)
    if (Math.abs(bedX - (doorX + TILE / 2)) < TILE / 2) {
      // Bed center fell within the door column — push it sideways so the
      // bed never blocks the door cutout.
      bedX = bedX > doorX + TILE / 2 ? Math.min(bedMaxX, bedX + TILE) : Math.max(bedMinX, bedX - TILE)
    }

    cells.push({
      rect: cellRect,
      bedPos: { x: bedX, y: bedY },
      doorRect: { x: doorX, y: partitionY, w: TILE, h: WALL_T },
      doorOrient: 'h',
    })

    cursor += w
  }

  // Fill the partition wall around the door cutouts.
  const sortedDoors = cells.map((c) => c.doorRect.x).slice().sort((a, b) => a - b)
  let leftEdge = building.x
  for (const dx of sortedDoors) {
    if (dx > leftEdge) {
      walls.push({ x: leftEdge, y: partitionY, w: dx - leftEdge, h: WALL_T })
    }
    leftEdge = dx + TILE
  }
  const buildingRightEdge = building.x + building.w
  if (buildingRightEdge > leftEdge) {
    walls.push({ x: leftEdge, y: partitionY, w: buildingRightEdge - leftEdge, h: WALL_T })
  }

  const corridor: Rect = {
    x: building.x + WALL_T,
    y: partitionY + WALL_T,
    w: building.w - 2 * WALL_T,
    h: building.y + building.h - WALL_T - (partitionY + WALL_T),
  }
  return { cells, walls, corridor }
}

// 高级公寓-style: cells along the east, corridor along the west, doors west.
export function generateLuxuryCells(
  building: Rect,
  cellCount: number,
  rng: SeededRng,
): GeneratedCellLayout {
  // 1-tile corridor — fixed so the exterior door always lands on it.
  const corridorW = TILE
  const partitionX = building.x + corridorW

  const buildingTilesH = Math.round(building.h / TILE)
  const heights = distribute(buildingTilesH, cellCount, 3, rng)

  const cells: GeneratedCell[] = []
  const walls: Rect[] = []

  // Cell mid-walls span only the cell area so the corridor stays continuous.
  let cursorY = building.y
  const cellRects: Rect[] = []
  for (let i = 0; i < cellCount; i++) {
    const h = heights[i] * TILE
    cellRects.push({
      x: partitionX,
      y: cursorY,
      w: building.x + building.w - partitionX,
      h,
    })
    if (i > 0) {
      walls.push({
        x: partitionX,
        y: cursorY,
        w: building.x + building.w - partitionX,
        h: WALL_T,
      })
    }
    cursorY += h
  }

  const doorYs: number[] = []
  for (const cell of cellRects) {
    const doorMinY = cell.y + TILE / 2
    const doorMaxY = cell.y + cell.h - TILE - TILE / 2
    doorYs.push(pickTileAligned(doorMinY, doorMaxY, rng))
  }
  const sortedDoors = doorYs.slice().sort((a, b) => a - b)
  let topEdge = building.y
  for (const dy of sortedDoors) {
    if (dy > topEdge) {
      walls.push({ x: partitionX, y: topEdge, w: WALL_T, h: dy - topEdge })
    }
    topEdge = dy + TILE
  }
  const buildingBottomEdge = building.y + building.h
  if (buildingBottomEdge > topEdge) {
    walls.push({ x: partitionX, y: topEdge, w: WALL_T, h: buildingBottomEdge - topEdge })
  }

  for (let i = 0; i < cellCount; i++) {
    const cell = cellRects[i]
    const doorY = doorYs[i]
    const bedMinX = cell.x + BED_MARGIN_PX + WALL_T
    const bedMaxX = cell.x + cell.w - BED_MARGIN_PX
    const bedMinY = cell.y + BED_MARGIN_PX
    const bedMaxY = cell.y + cell.h - BED_MARGIN_PX
    let bedY = bedMinY + rng.uniform() * (bedMaxY - bedMinY)
    if (Math.abs(bedY - (doorY + TILE / 2)) < TILE / 2) {
      bedY = bedY > doorY + TILE / 2 ? Math.min(bedMaxY, bedY + TILE) : Math.max(bedMinY, bedY - TILE)
    }
    const bedX = bedMinX + rng.uniform() * (bedMaxX - bedMinX)

    cells.push({
      rect: cell,
      bedPos: { x: bedX, y: bedY },
      doorRect: { x: partitionX, y: doorY, w: WALL_T, h: TILE },
      doorOrient: 'v',
    })
  }

  const corridor: Rect = {
    x: building.x + WALL_T,
    y: building.y + WALL_T,
    w: corridorW - WALL_T,
    h: building.h - 2 * WALL_T,
  }
  return { cells, walls, corridor }
}
