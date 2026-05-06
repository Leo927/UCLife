// Sub-block → building assignment.
//
// Per-district greedy: process sub-blocks largest-first; for each, pack
// up to `buildingsPerBlockMax` buildings flush along the chosen road wall,
// advancing a frontage cursor after each placement. For each slot, pick a
// type that still has unmet `min`, falling back to types under `max`.
// Filter out types that can't fit (size or cell-orientation constraint).
// The largest-first sort ensures big mandatory types (e.g. airport) land
// in blocks that can host them before smaller types claim everything.

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

// Try to size + position a building within the remaining frontage strip
// of `sb`, starting at `cursorTiles` along the wall parallel to `doorSide`.
// Buildings sit flush against that wall; the perpendicular axis is depth.
// Returns null if the type's min size doesn't fit, the orientation can't
// host the cell count the type needs, or the strip is exhausted.
function fitBuildingInStrip(
  typeId: string,
  sb: SubBlock,
  doorSide: Side,
  cursorTiles: number,
  rng: SeededRng,
): { rect: { x: number; y: number; w: number; h: number }; frontageTiles: number } | null {
  const btype = getBuildingType(typeId)
  const sbWTiles = Math.floor(sb.rect.w / TILE)
  const sbHTiles = Math.floor(sb.rect.h / TILE)
  const horizontal = doorSide === 'n' || doorSide === 's'
  const frontageTotal = horizontal ? sbWTiles : sbHTiles
  const depthTotal = horizontal ? sbHTiles : sbWTiles
  const frontageMax = frontageTotal - cursorTiles
  if (frontageMax <= 0) return null

  let buildFrontage: number
  let buildDepth: number

  if (isFixedSize(btype.size)) {
    buildFrontage = horizontal ? btype.size.w : btype.size.h
    buildDepth = horizontal ? btype.size.h : btype.size.w
    if (buildFrontage > frontageMax || buildDepth > depthTotal) return null
  } else {
    const minFrontage = horizontal ? btype.size.minW : btype.size.minH
    const maxFrontage = horizontal ? btype.size.maxW : btype.size.maxH
    const minDepth = horizontal ? btype.size.minH : btype.size.minW
    const maxDepth = horizontal ? btype.size.maxH : btype.size.maxW

    let effMinFrontage = minFrontage
    let effMinDepth = minDepth
    const effMaxFrontage = Math.min(maxFrontage, frontageMax)
    const effMaxDepth = Math.min(maxDepth, depthTotal)

    if (btype.layout.algorithm === 'cells') {
      // Horizontal corridor: cells need ≥2 tiles each along the frontage.
      // Vertical corridor: cells need ≥3 tiles each along the frontage.
      const cellMul = horizontal ? 2 : 3
      if (btype.layout.minCells * cellMul > frontageMax) return null
      effMinFrontage = Math.max(effMinFrontage, btype.layout.minCells * cellMul)
    }

    if (effMinFrontage > effMaxFrontage || effMinDepth > effMaxDepth) return null

    buildFrontage = rng.intRange(effMinFrontage, effMaxFrontage)
    buildDepth = rng.intRange(effMinDepth, effMaxDepth)
  }

  const sbX = sb.rect.x / TILE
  const sbY = sb.rect.y / TILE
  let bx: number
  let by: number
  if (doorSide === 'n') {
    bx = sbX + cursorTiles
    by = sbY
  } else if (doorSide === 's') {
    bx = sbX + cursorTiles
    by = sbY + sbHTiles - buildDepth
  } else if (doorSide === 'w') {
    bx = sbX
    by = sbY + cursorTiles
  } else {
    bx = sbX + sbWTiles - buildDepth
    by = sbY + cursorTiles
  }

  const buildWTiles = horizontal ? buildFrontage : buildDepth
  const buildHTiles = horizontal ? buildDepth : buildFrontage
  return {
    rect: { x: bx * TILE, y: by * TILE, w: buildWTiles * TILE, h: buildHTiles * TILE },
    frontageTiles: buildFrontage,
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
  // Reserved sub-blocks are routed to a hand-crafted building by spawn.ts;
  // procgen building assignment skips them.
  const buckets = new Map<string, SubBlock[]>()
  for (const d of districts) buckets.set(d.id, [])
  for (const sb of subBlocks) {
    if (sb.reservedFor) continue
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
    const perBlockMax = Math.max(1, district.buildingsPerBlockMax ?? 1)

    for (const sb of blocks) {
      const door = pickDoorSide(sb.adjacentRoads)
      if (!door) continue

      // Per-sub-block placement counts. Used to break ties towards
      // unused types so a max-5 strip doesn't degenerate into five
      // copies of the same building. Lifted out of the inner loop so
      // every slot sees the in-block history.
      const placedInBlock = new Map<string, number>()
      const inBlock = (id: string) => placedInBlock.get(id) ?? 0
      const leastPlacedInBlock = <T extends { entry: DistrictTypeEntry }>(arr: T[]): T[] => {
        const minN = Math.min(...arr.map((c) => inBlock(c.entry.id)))
        return arr.filter((c) => inBlock(c.entry.id) === minN)
      }

      let cursorTiles = 0
      for (let placed = 0; placed < perBlockMax; placed++) {
        type Candidate = {
          entry: DistrictTypeEntry
          rect: { x: number; y: number; w: number; h: number }
          frontageTiles: number
        }
        const candidates: Candidate[] = []
        for (const entry of district.types) {
          const placedCnt = placedCount.get(entry.id)!
          const max = entry.max ?? Infinity
          if (placedCnt >= max) continue
          const fit = fitBuildingInStrip(entry.id, sb, door.side, cursorTiles, rng)
          if (!fit) continue
          candidates.push({ entry, rect: fit.rect, frontageTiles: fit.frontageTiles })
        }
        if (candidates.length === 0) break

        // Prefer types with unmet min. Among those, the one with the
        // largest min footprint goes first, so airport (8×6) claims a big
        // block before shop (6×4) takes everything for itself. Within
        // the same footprint band, prefer types not yet placed in this
        // sub-block; among those, randomize.
        const mustPlace = candidates.filter((c) => {
          const placedCnt = placedCount.get(c.entry.id)!
          const min = c.entry.min ?? 0
          return placedCnt < min
        })
        let chosen: Candidate
        if (mustPlace.length > 0) {
          const sized = mustPlace
            .map((c) => ({ c, area: minFootprint(c.entry.id) }))
            .sort((a, b) => b.area - a.area)
          const topArea = sized[0].area
          const tied = sized.filter((s) => s.area === topArea).map((s) => s.c)
          const fresh = leastPlacedInBlock(tied)
          chosen = fresh[rng.intRange(0, fresh.length - 1)]
        } else {
          const fresh = leastPlacedInBlock(candidates)
          chosen = fresh[rng.intRange(0, fresh.length - 1)]
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
        placedInBlock.set(chosen.entry.id, inBlock(chosen.entry.id) + 1)
        cursorTiles += chosen.frontageTiles
      }
    }
  }

  return result
}
