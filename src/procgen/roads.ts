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
// Reserved rects: tile-space rects passed in by the caller (e.g. for a big
// hand-crafted building like the AE Complex). The grid forces avenue bands
// at the rect's east/west edges and street bands at its north/south edges,
// excludes the rect's interior from random fill, never alleyizes the
// resulting super-block, and tags it with `reservedFor: typeId`. Spawn then
// drops the crafted building straight into that sub-block.
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
  // When set, this sub-block is reserved for a hand-crafted building of
  // this typeId. Procgen building assignment skips it; spawn places the
  // crafted building here.
  reservedFor?: string
}

// Resolved reserved rect: tile-space, end-exclusive, with the building
// typeId that will be placed in it.
export type ReservedRect = {
  typeId: string
  rect: { x: number; y: number; w: number; h: number }
}

export type RoadGrid = {
  segments: RoadSegment[]
  subBlocks: SubBlock[]
}

type Band = { start: number; end: number }  // tile-space; end exclusive
type Range = { lo: number; hi: number }     // tile-space; hi exclusive

// Place bands of width `widthTiles` across [from, to). Each band starts
// after a random gap in [spacing.min, spacing.max] from the previous band's
// end (or from `from` for the first band), so no road sits flush against
// the segment edge.
//
// `forcedStarts`: anchor positions where bands MUST sit. `blocked`: ranges
// where random bands MUST NOT be placed (the interior of reserved rects).
// Random bands fill the gaps between forced+blocked intervals; forced
// bands and any band landing in a non-empty gap are returned together,
// sorted by start.
function placeBands(
  from: number,
  to: number,
  spacing: { min: number; max: number },
  widthTiles: number,
  rng: SeededRng,
  forcedStarts: readonly number[] = [],
  blocked: readonly Range[] = [],
): Band[] {
  const forced: Band[] = []
  for (const a of forcedStarts) {
    if (a >= from && a + widthTiles <= to) forced.push({ start: a, end: a + widthTiles })
  }
  forced.sort((a, b) => a.start - b.start)

  const occupied: Range[] = [
    ...forced.map((b) => ({ lo: b.start, hi: b.end })),
    ...blocked,
  ].sort((a, b) => a.lo - b.lo)
  const merged: Range[] = []
  for (const o of occupied) {
    const top = merged[merged.length - 1]
    if (top && o.lo <= top.hi) top.hi = Math.max(top.hi, o.hi)
    else merged.push({ ...o })
  }

  const segments: Range[] = []
  let cursor = from
  for (const m of merged) {
    if (m.lo > cursor) segments.push({ lo: cursor, hi: m.lo })
    cursor = m.hi
  }
  if (to > cursor) segments.push({ lo: cursor, hi: to })

  const out: Band[] = [...forced]
  for (const seg of segments) {
    let c = seg.lo
    for (;;) {
      const gap = rng.intRange(spacing.min, spacing.max)
      c += gap
      if (c + widthTiles > seg.hi) break
      out.push({ start: c, end: c + widthTiles })
      c += widthTiles
    }
  }
  out.sort((a, b) => a.start - b.start)
  return out
}

export function generateRoadGrid(
  rect: { x: number; y: number; w: number; h: number },  // tile-space
  cfg: RoadGridConfig,
  rng: SeededRng,
  reservedRects: readonly ReservedRect[] = [],
): RoadGrid {
  const xMin = rect.x
  const xMax = rect.x + rect.w
  const yMin = rect.y
  const yMax = rect.y + rect.h

  const aw = cfg.avenueWidthTiles
  const sw = cfg.streetWidthTiles
  const avenueAnchors: number[] = []
  const streetAnchors: number[] = []
  const xExcl: Range[] = []
  const yExcl: Range[] = []
  for (const r of reservedRects) {
    avenueAnchors.push(r.rect.x - aw, r.rect.x + r.rect.w)
    streetAnchors.push(r.rect.y - sw, r.rect.y + r.rect.h)
    xExcl.push({ lo: r.rect.x, hi: r.rect.x + r.rect.w })
    yExcl.push({ lo: r.rect.y, hi: r.rect.y + r.rect.h })
  }

  const avenues = placeBands(
    xMin, xMax, cfg.avenueSpacingTiles, aw, rng, avenueAnchors, xExcl,
  )
  const streets = placeBands(
    yMin, yMax, cfg.streetSpacingTiles, sw, rng, streetAnchors, yExcl,
  )

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
    reservedFor?: string
  }

  const superBlocks: SBTiles[] = []
  for (const yi of yIntervals) {
    for (const xi of xIntervals) {
      const adj: AdjacentRoad[] = []
      if (xi.left > xMin)   adj.push({ side: 'w', kind: 'avenue' })
      if (xi.right < xMax)  adj.push({ side: 'e', kind: 'avenue' })
      if (yi.top > yMin)    adj.push({ side: 'n', kind: 'street' })
      if (yi.bottom < yMax) adj.push({ side: 's', kind: 'street' })
      const reserved = reservedRects.find(
        (r) => r.rect.x === xi.left && r.rect.y === yi.top
            && r.rect.x + r.rect.w === xi.right && r.rect.y + r.rect.h === yi.bottom,
      )
      superBlocks.push({
        left: xi.left, right: xi.right, top: yi.top, bottom: yi.bottom,
        adjacent: adj,
        reservedFor: reserved?.typeId,
      })
    }
  }

  // Subdivide super-blocks via alleys (single-level recursion).
  function withAdj(adj: AdjacentRoad[], side: Side, road: AdjacentRoad | null): AdjacentRoad[] {
    const filtered = adj.filter((r) => r.side !== side)
    return road ? [...filtered, road] : filtered
  }

  function alleyize(sb: SBTiles, depth: number): SBTiles[] {
    if (sb.reservedFor) return [sb]
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
  // Reserved blocks are kept regardless — the caller validated their size.
  const subBlocks: SubBlock[] = splitSubBlocks
    .filter((sb) => sb.reservedFor || ((sb.right - sb.left) >= 5 && (sb.bottom - sb.top) >= 3))
    .map((sb) => ({
      rect: {
        x: sb.left * TILE,
        y: sb.top * TILE,
        w: (sb.right - sb.left) * TILE,
        h: (sb.bottom - sb.top) * TILE,
      },
      adjacentRoads: sb.adjacent,
      ...(sb.reservedFor ? { reservedFor: sb.reservedFor } : {}),
    }))

  return { segments, subBlocks }
}
