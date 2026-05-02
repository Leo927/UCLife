// Manhattan road grid generator.
//
// Pipeline:
//   1. Place vertical avenue bands across the rect at randomized gaps.
//   2. Place horizontal street bands top-to-bottom likewise.
//   3. The two band sets define a grid of super-blocks (the rectangles NOT
//      covered by roads).
//   4. For each super-block, with probability cfg.alleyChance, split along
//      its longer axis with one alley (single-level recursion).
//   5. The remaining sub-blocks become building-eligible areas; each carries
//      a list of adjacent roads (which side, which kind).
//
// All inputs are tile-space; outputs are pixel-space rects so spawn.ts can
// hand them straight to entity creation.

import type { SeededRng } from './rng'
import type { RoadGridConfig } from '../data/scenes'
import { worldConfig } from '../config'

const TILE = worldConfig.tilePx

export type RoadKind = 'avenue' | 'street' | 'alley'
export type Side = 'n' | 's' | 'e' | 'w'

export type RoadSegment = {
  rect: { x: number; y: number; w: number; h: number }
  kind: RoadKind
}

export type AdjacentRoad = { side: Side; kind: RoadKind }

export type SubBlock = {
  rect: { x: number; y: number; w: number; h: number }
  adjacentRoads: AdjacentRoad[]
}

export type RoadGrid = {
  segments: RoadSegment[]
  subBlocks: SubBlock[]
}

type Band = { start: number; end: number }  // tile-space; end exclusive

// Place bands of width `widthTiles` across [from, to) with random gaps in
// [spacing.min, spacing.max]. The first band is offset by a random gap, so
// no road ever sits flush against the procgen rect edge.
function placeBands(
  from: number,
  to: number,
  spacing: { min: number; max: number },
  widthTiles: number,
  rng: SeededRng,
): Band[] {
  const out: Band[] = []
  let cursor = from
  for (;;) {
    const gap = rng.intRange(spacing.min, spacing.max)
    cursor += gap
    if (cursor + widthTiles > to) break
    out.push({ start: cursor, end: cursor + widthTiles })
    cursor += widthTiles
  }
  return out
}

export function generateRoadGrid(
  rect: { x: number; y: number; w: number; h: number },  // tile-space
  cfg: RoadGridConfig,
  rng: SeededRng,
): RoadGrid {
  const xMin = rect.x
  const xMax = rect.x + rect.w
  const yMin = rect.y
  const yMax = rect.y + rect.h

  const avenues = placeBands(xMin, xMax, cfg.avenueSpacingTiles, cfg.avenueWidthTiles, rng)
  const streets = placeBands(yMin, yMax, cfg.streetSpacingTiles, cfg.streetWidthTiles, rng)

  const segments: RoadSegment[] = []
  for (const a of avenues) {
    segments.push({
      rect: { x: a.start * TILE, y: yMin * TILE, w: (a.end - a.start) * TILE, h: rect.h * TILE },
      kind: 'avenue',
    })
  }
  for (const s of streets) {
    segments.push({
      rect: { x: xMin * TILE, y: s.start * TILE, w: rect.w * TILE, h: (s.end - s.start) * TILE },
      kind: 'street',
    })
  }

  // X / Y intervals = the spaces between road bands. Cross-product = super-blocks.
  type XInterval = { left: number; right: number }
  type YInterval = { top: number; bottom: number }

  const xIntervals: XInterval[] = []
  {
    let cursor = xMin
    for (const a of avenues) {
      if (a.start > cursor) xIntervals.push({ left: cursor, right: a.start })
      cursor = a.end
    }
    if (xMax > cursor) xIntervals.push({ left: cursor, right: xMax })
  }
  const yIntervals: YInterval[] = []
  {
    let cursor = yMin
    for (const s of streets) {
      if (s.start > cursor) yIntervals.push({ top: cursor, bottom: s.start })
      cursor = s.end
    }
    if (yMax > cursor) yIntervals.push({ top: cursor, bottom: yMax })
  }

  type SBTiles = {
    left: number; right: number; top: number; bottom: number
    adjacent: AdjacentRoad[]
  }

  const superBlocks: SBTiles[] = []
  for (const yi of yIntervals) {
    for (const xi of xIntervals) {
      const adj: AdjacentRoad[] = []
      if (xi.left > xMin)   adj.push({ side: 'w', kind: 'avenue' })
      if (xi.right < xMax)  adj.push({ side: 'e', kind: 'avenue' })
      if (yi.top > yMin)    adj.push({ side: 'n', kind: 'street' })
      if (yi.bottom < yMax) adj.push({ side: 's', kind: 'street' })
      superBlocks.push({
        left: xi.left, right: xi.right, top: yi.top, bottom: yi.bottom,
        adjacent: adj,
      })
    }
  }

  // Subdivide super-blocks via alleys (single-level recursion).
  function withAdj(adj: AdjacentRoad[], side: Side, road: AdjacentRoad | null): AdjacentRoad[] {
    const filtered = adj.filter((r) => r.side !== side)
    return road ? [...filtered, road] : filtered
  }

  function alleyize(sb: SBTiles, depth: number): SBTiles[] {
    if (depth >= 1) return [sb]
    const w = sb.right - sb.left
    const h = sb.bottom - sb.top
    if (Math.min(w, h) < cfg.alleyMinBlockTiles) return [sb]
    if (rng.uniform() >= cfg.alleyChance) return [sb]

    const aw = cfg.alleyWidthTiles
    // Each child must have ≥ minHalf tiles on the dimension being split, or
    // the alley is too close to an edge to be useful.
    const minHalf = Math.max(3, Math.floor(cfg.alleyMinBlockTiles / 2))

    if (w >= h) {
      const lo = sb.left + minHalf
      const hi = sb.right - aw - minHalf
      if (hi < lo) return [sb]
      const splitX = rng.intRange(lo, hi)
      segments.push({
        rect: { x: splitX * TILE, y: sb.top * TILE, w: aw * TILE, h: h * TILE },
        kind: 'alley',
      })
      const left: SBTiles = {
        left: sb.left, right: splitX, top: sb.top, bottom: sb.bottom,
        adjacent: withAdj(sb.adjacent, 'e', { side: 'e', kind: 'alley' }),
      }
      const right: SBTiles = {
        left: splitX + aw, right: sb.right, top: sb.top, bottom: sb.bottom,
        adjacent: withAdj(sb.adjacent, 'w', { side: 'w', kind: 'alley' }),
      }
      return [...alleyize(left, depth + 1), ...alleyize(right, depth + 1)]
    } else {
      const lo = sb.top + minHalf
      const hi = sb.bottom - aw - minHalf
      if (hi < lo) return [sb]
      const splitY = rng.intRange(lo, hi)
      segments.push({
        rect: { x: sb.left * TILE, y: splitY * TILE, w: w * TILE, h: aw * TILE },
        kind: 'alley',
      })
      const top: SBTiles = {
        left: sb.left, right: sb.right, top: sb.top, bottom: splitY,
        adjacent: withAdj(sb.adjacent, 's', { side: 's', kind: 'alley' }),
      }
      const bottom: SBTiles = {
        left: sb.left, right: sb.right, top: splitY + aw, bottom: sb.bottom,
        adjacent: withAdj(sb.adjacent, 'n', { side: 'n', kind: 'alley' }),
      }
      return [...alleyize(top, depth + 1), ...alleyize(bottom, depth + 1)]
    }
  }

  const splitSubBlocks: SBTiles[] = []
  for (const sb of superBlocks) {
    splitSubBlocks.push(...alleyize(sb, 0))
  }

  // Drop blocks too small to host any building (smallest is 5x3 tiles).
  const subBlocks: SubBlock[] = splitSubBlocks
    .filter((sb) => (sb.right - sb.left) >= 5 && (sb.bottom - sb.top) >= 3)
    .map((sb) => ({
      rect: {
        x: sb.left * TILE,
        y: sb.top * TILE,
        w: (sb.right - sb.left) * TILE,
        h: (sb.bottom - sb.top) * TILE,
      },
      adjacentRoads: sb.adjacent,
    }))

  return { segments, subBlocks }
}
