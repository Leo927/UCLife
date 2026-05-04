import { describe, expect, it } from 'vitest'
import { worldConfig } from '../config'
import type { RoadGridConfig } from '../data/scenes'
import { SeededRng } from './rng'
import { generateRoadGrid, type RoadGrid, type Side } from './roads'

const TILE = worldConfig.tilePx

const cfg: RoadGridConfig = {
  avenueSpacingTiles: { min: 6, max: 10 },
  streetSpacingTiles: { min: 5, max: 9 },
  avenueWidthTiles: 2,
  streetWidthTiles: 2,
  alleyChance: 0.7,
  alleyWidthTiles: 1,
  alleyMinBlockTiles: 6,
}

const RECT = { x: 0, y: 0, w: 60, h: 40 }

function gridFor(seed: number): RoadGrid {
  return generateRoadGrid(RECT, cfg, SeededRng.fromNumber(seed))
}

function pixelRect(rect: { x: number; y: number; w: number; h: number }) {
  return {
    x: RECT.x * TILE, y: RECT.y * TILE,
    w: rect.w * TILE, h: rect.h * TILE,
  }
}

describe('generateRoadGrid — determinism', () => {
  it('produces an identical RoadGrid for the same seed', () => {
    expect(gridFor(123)).toEqual(gridFor(123))
  })

  it('produces different layouts for different seeds', () => {
    expect(gridFor(1)).not.toEqual(gridFor(2))
  })
})

describe('generateRoadGrid — segment containment', () => {
  it('keeps every road segment fully inside the rect', () => {
    const { segments } = gridFor(7)
    expect(segments.length).toBeGreaterThan(0)
    const bounds = pixelRect(RECT)
    for (const s of segments) {
      expect(s.rect.x).toBeGreaterThanOrEqual(bounds.x)
      expect(s.rect.y).toBeGreaterThanOrEqual(bounds.y)
      expect(s.rect.x + s.rect.w).toBeLessThanOrEqual(bounds.x + bounds.w)
      expect(s.rect.y + s.rect.h).toBeLessThanOrEqual(bounds.y + bounds.h)
    }
  })

  it('emits avenues spanning full rect height and streets spanning full rect width', () => {
    const { segments } = gridFor(13)
    const bounds = pixelRect(RECT)
    for (const s of segments) {
      if (s.kind === 'avenue') expect(s.rect.h).toBe(bounds.h)
      if (s.kind === 'street') expect(s.rect.w).toBe(bounds.w)
    }
  })

  it('places at least one avenue and one street given roomy spacing', () => {
    const { segments } = gridFor(99)
    expect(segments.some((s) => s.kind === 'avenue')).toBe(true)
    expect(segments.some((s) => s.kind === 'street')).toBe(true)
  })
})

describe('generateRoadGrid — sub-block containment', () => {
  it('keeps every sub-block fully inside the rect', () => {
    const { subBlocks } = gridFor(33)
    expect(subBlocks.length).toBeGreaterThan(0)
    const bounds = pixelRect(RECT)
    for (const sb of subBlocks) {
      expect(sb.rect.x).toBeGreaterThanOrEqual(bounds.x)
      expect(sb.rect.y).toBeGreaterThanOrEqual(bounds.y)
      expect(sb.rect.x + sb.rect.w).toBeLessThanOrEqual(bounds.x + bounds.w)
      expect(sb.rect.y + sb.rect.h).toBeLessThanOrEqual(bounds.y + bounds.h)
    }
  })

  it('drops sub-blocks below the 5×3 tile minimum', () => {
    const { subBlocks } = gridFor(44)
    for (const sb of subBlocks) {
      expect(sb.rect.w).toBeGreaterThanOrEqual(5 * TILE)
      expect(sb.rect.h).toBeGreaterThanOrEqual(3 * TILE)
    }
  })

  it('does not overlap any sub-block with a road segment', () => {
    const { segments, subBlocks } = gridFor(101)
    function overlaps(a: { x: number; y: number; w: number; h: number },
                     b: { x: number; y: number; w: number; h: number }) {
      return a.x < b.x + b.w && a.x + a.w > b.x
        && a.y < b.y + b.h && a.y + a.h > b.y
    }
    for (const sb of subBlocks) {
      for (const seg of segments) {
        expect(
          overlaps(sb.rect, seg.rect),
          `sub-block ${JSON.stringify(sb.rect)} overlaps ${seg.kind} ${JSON.stringify(seg.rect)}`,
        ).toBe(false)
      }
    }
  })
})

describe('generateRoadGrid — adjacent-road tagging', () => {
  it('tags only roads that touch the sub-block on the matching side', () => {
    const { segments, subBlocks } = gridFor(55)
    function touchesOnSide(
      sb: { x: number; y: number; w: number; h: number },
      seg: { x: number; y: number; w: number; h: number },
      side: Side,
    ): boolean {
      switch (side) {
        case 'n': return seg.y + seg.h === sb.y
          && seg.x < sb.x + sb.w && seg.x + seg.w > sb.x
        case 's': return seg.y === sb.y + sb.h
          && seg.x < sb.x + sb.w && seg.x + seg.w > sb.x
        case 'w': return seg.x + seg.w === sb.x
          && seg.y < sb.y + sb.h && seg.y + seg.h > sb.y
        case 'e': return seg.x === sb.x + sb.w
          && seg.y < sb.y + sb.h && seg.y + seg.h > sb.y
      }
    }
    for (const sb of subBlocks) {
      for (const adj of sb.adjacentRoads) {
        const touching = segments.some(
          (seg) => seg.kind === adj.kind && touchesOnSide(sb.rect, seg.rect, adj.side),
        )
        expect(
          touching,
          `sub-block ${JSON.stringify(sb.rect)} tags ${adj.side}/${adj.kind} but no segment touches there`,
        ).toBe(true)
      }
    }
  })

  it('reports at least one adjacent road for every sub-block (no orphans)', () => {
    const { subBlocks } = gridFor(202)
    for (const sb of subBlocks) {
      expect(sb.adjacentRoads.length).toBeGreaterThan(0)
    }
  })
})
