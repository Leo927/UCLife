// Sub-block → building assignment.
//
// Per-district greedy: process sub-blocks largest-first; for each, pick a
// type that still has unmet `min`, falling back to types under `max`. Filter
// out types that can't fit (size or cell-orientation constraint). The
// largest-first sort ensures big mandatory types (e.g. airport) land in
// blocks that can host them before smaller types claim everything.

import type { SeededRng } from './rng'
import type { SubBlock, AdjacentRoad, Side } from './roads'
import type { DistrictConfig, DistrictTypeEntry } from '../data/scenes'
import type { DoorPlacement, PlacedBuilding } from './slots'
import { getBuildingType, isFixedSize } from '../data/buildingTypes'
import { worldConfig } from '../config'

const TILE = worldConfig.tilePx

// Avenue > street > alley; tie-break N > E > S > W.
const ROAD_PRIORITY: Record<'avenue' | 'street' | 'alley', number> = {
  avenue: 0, street: 1, alley: 2,
}
const SIDE_PRIORITY: Record<Side, number> = { n: 0, e: 1, s: 2, w: 3 }

function pickDoorSide(adjacent: AdjacentRoad[]): AdjacentRoad | null {
  if (adjacent.length === 0) return null
  return [...adjacent].sort((a, b) => {
    const pa = ROAD_PRIORITY[a.kind] - ROAD_PRIORITY[b.kind]
    if (pa !== 0) return pa
    return SIDE_PRIORITY[a.side] - SIDE_PRIORITY[b.side]
  })[0]
}

function pickDistrict(
  procgenRect: { x: number; y: number; w: number; h: number },  // tile-space
  sb: SubBlock,
  districts: readonly DistrictConfig[],
): DistrictConfig | null {
  if (districts.length === 0) return null
  const cxRel = (sb.rect.x + sb.rect.w / 2) / TILE - procgenRect.x
  const cyRel = (sb.rect.y + sb.rect.h / 2) / TILE - procgenRect.y

  for (const d of districts) {
    if (cxRel >= d.rect.x && cxRel < d.rect.x + d.rect.w &&
        cyRel >= d.rect.y && cyRel < d.rect.y + d.rect.h) {
      return d
    }
  }
  let best: DistrictConfig | null = null
  let bestD = Infinity
  for (const d of districts) {
    const dcx = d.rect.x + d.rect.w / 2
    const dcy = d.rect.y + d.rect.h / 2
    const dist = (cxRel - dcx) ** 2 + (cyRel - dcy) ** 2
    if (dist < bestD) { bestD = dist; best = d }
  }
  return best
}

// Try to size the building so it fits the sub-block. Returns null if the
// type's min size doesn't fit or if the chosen orientation can't host the
// cell count the type needs.
function fitBuilding(
  typeId: string,
  sb: SubBlock,
  doorSide: Side,
  rng: SeededRng,
): { rect: { x: number; y: number; w: number; h: number } } | null {
  const btype = getBuildingType(typeId)
  if (isFixedSize(btype.size)) {
    const w = btype.size.w
    const h = btype.size.h
    const sbWTiles = Math.floor(sb.rect.w / TILE)
    const sbHTiles = Math.floor(sb.rect.h / TILE)
    if (w > sbWTiles || h > sbHTiles) return null
    return placeAlignedToDoor(sb, w, h, doorSide)
  }

  const sbWTiles = Math.floor(sb.rect.w / TILE)
  const sbHTiles = Math.floor(sb.rect.h / TILE)
  const effMaxW = Math.min(btype.size.maxW, sbWTiles)
  const effMaxH = Math.min(btype.size.maxH, sbHTiles)
  if (btype.size.minW > effMaxW || btype.size.minH > effMaxH) return null

  if (btype.layout.algorithm === 'cells') {
    const horizontal = doorSide === 'n' || doorSide === 's'
    if (horizontal && btype.layout.minCells * 2 > effMaxW) return null
    if (!horizontal && btype.layout.minCells * 3 > effMaxH) return null
  }

  const w = rng.intRange(btype.size.minW, effMaxW)
  const h = rng.intRange(btype.size.minH, effMaxH)
  return placeAlignedToDoor(sb, w, h, doorSide)
}

function placeAlignedToDoor(
  sb: SubBlock,
  buildWTiles: number,
  buildHTiles: number,
  doorSide: Side,
): { rect: { x: number; y: number; w: number; h: number } } {
  const sbX = sb.rect.x / TILE
  const sbY = sb.rect.y / TILE
  const sbW = sb.rect.w / TILE
  const sbH = sb.rect.h / TILE

  let bx = sbX
  let by = sbY
  if (doorSide === 'n') {
    by = sbY
    bx = sbX + Math.floor((sbW - buildWTiles) / 2)
  } else if (doorSide === 's') {
    by = sbY + sbH - buildHTiles
    bx = sbX + Math.floor((sbW - buildWTiles) / 2)
  } else if (doorSide === 'w') {
    bx = sbX
    by = sbY + Math.floor((sbH - buildHTiles) / 2)
  } else {
    bx = sbX + sbW - buildWTiles
    by = sbY + Math.floor((sbH - buildHTiles) / 2)
  }
  return {
    rect: { x: bx * TILE, y: by * TILE, w: buildWTiles * TILE, h: buildHTiles * TILE },
  }
}

function pickDoorOffset(wallTiles: number, rng: SeededRng): number {
  const max = Math.max(1, wallTiles - 2)
  return rng.intRange(1, max) * TILE
}

function oppositeOf(s: Side): Side {
  return s === 'n' ? 's' : s === 's' ? 'n' : s === 'e' ? 'w' : 'e'
}

function blockArea(sb: SubBlock): number {
  return sb.rect.w * sb.rect.h
}

// Footprint area (tile²) at the type's minimum size. Drives the order
// must-place types are assigned to blocks: bigger first.
function minFootprint(typeId: string): number {
  const btype = getBuildingType(typeId)
  if (isFixedSize(btype.size)) return btype.size.w * btype.size.h
  return btype.size.minW * btype.size.minH
}

export function assignBuildings(
  procgenRect: { x: number; y: number; w: number; h: number },  // tile-space
  subBlocks: readonly SubBlock[],
  districts: readonly DistrictConfig[],
  rng: SeededRng,
): PlacedBuilding[] {
  // Bucket sub-blocks per district, sort each bucket largest-first so
  // large mandatory types (airports) get first dibs on big blocks.
  const buckets = new Map<string, SubBlock[]>()
  for (const d of districts) buckets.set(d.id, [])
  for (const sb of subBlocks) {
    const d = pickDistrict(procgenRect, sb, districts)
    if (!d) continue
    if (!buckets.has(d.id)) buckets.set(d.id, [])
    buckets.get(d.id)!.push(sb)
  }
  for (const list of buckets.values()) list.sort((a, b) => blockArea(b) - blockArea(a))

  const result: PlacedBuilding[] = []

  for (const district of districts) {
    const blocks = buckets.get(district.id) ?? []
    const placedCount = new Map<string, number>()
    for (const t of district.types) placedCount.set(t.id, 0)

    for (const sb of blocks) {
      const door = pickDoorSide(sb.adjacentRoads)
      if (!door) continue

      // Build candidate list: (type entry, fit). Filter to fitting types.
      type Candidate = { entry: DistrictTypeEntry; rect: { x: number; y: number; w: number; h: number } }
      const candidates: Candidate[] = []
      for (const entry of district.types) {
        const placed = placedCount.get(entry.id)!
        const max = entry.max ?? Infinity
        if (placed >= max) continue
        const fit = fitBuilding(entry.id, sb, door.side, rng)
        if (!fit) continue
        candidates.push({ entry, rect: fit.rect })
      }
      if (candidates.length === 0) continue

      // Prefer types with unmet min. Among those, the one with the
      // largest min footprint goes first, so airport (8×6) claims a big
      // block before shop (6×4) takes everything for itself. Within the
      // same footprint band, randomize.
      const mustPlace = candidates.filter((c) => {
        const placed = placedCount.get(c.entry.id)!
        const min = c.entry.min ?? 0
        return placed < min
      })
      let chosen: Candidate
      if (mustPlace.length > 0) {
        const sized = mustPlace
          .map((c) => ({ c, area: minFootprint(c.entry.id) }))
          .sort((a, b) => b.area - a.area)
        const topArea = sized[0].area
        const tied = sized.filter((s) => s.area === topArea).map((s) => s.c)
        chosen = tied[rng.intRange(0, tied.length - 1)]
      } else {
        chosen = candidates[rng.intRange(0, candidates.length - 1)]
      }

      const wallTiles = (door.side === 'n' || door.side === 's')
        ? chosen.rect.w / TILE
        : chosen.rect.h / TILE
      const primaryOffsetPx = pickDoorOffset(wallTiles, rng)
      const primaryDoor: DoorPlacement = {
        side: door.side, offsetPx: primaryOffsetPx, widthPx: TILE,
      }

      const btype = getBuildingType(chosen.entry.id)
      const extraDoors: DoorPlacement[] = []
      if (btype.layout.algorithm === 'open_floor' && btype.layout.extraDoors) {
        const oppSide = oppositeOf(door.side)
        const oppWallTiles = (oppSide === 'n' || oppSide === 's')
          ? chosen.rect.w / TILE
          : chosen.rect.h / TILE
        for (const ed of btype.layout.extraDoors) {
          const off = ed.tiedToPrimary
            ? primaryOffsetPx
            : pickDoorOffset(oppWallTiles, rng)
          extraDoors.push({ side: oppSide, offsetPx: off, widthPx: TILE })
        }
      }

      result.push({
        typeId: chosen.entry.id,
        slot: { rect: chosen.rect, primaryDoor, extraDoors },
      })
      placedCount.set(chosen.entry.id, (placedCount.get(chosen.entry.id) ?? 0) + 1)
    }
  }

  return result
}
