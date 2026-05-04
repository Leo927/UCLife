import { describe, expect, it } from 'vitest'
import {
  generateCells,
  maxHorizontalCells,
  maxVerticalCells,
  type Rect,
} from './cells'
import { SeededRng } from './rng'

const TILE = 32

function rectAt(x: number, y: number, wTiles: number, hTiles: number): Rect {
  return { x: x * TILE, y: y * TILE, w: wTiles * TILE, h: hTiles * TILE }
}

function rectContains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w
    && inner.y + inner.h <= outer.y + outer.h
}

function pointInRect(p: { x: number; y: number }, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w
    && p.y >= r.y && p.y <= r.y + r.h
}

describe('maxHorizontalCells / maxVerticalCells', () => {
  it('counts ≥2-tile cells along x for horizontal layouts', () => {
    expect(maxHorizontalCells(rectAt(0, 0, 4, 6))).toBe(2)
    expect(maxHorizontalCells(rectAt(0, 0, 5, 6))).toBe(2)   // floor(5/2)
    expect(maxHorizontalCells(rectAt(0, 0, 8, 6))).toBe(4)
    expect(maxHorizontalCells(rectAt(0, 0, 1, 6))).toBe(0)
  })

  it('counts ≥3-tile cells along y for vertical layouts', () => {
    expect(maxVerticalCells(rectAt(0, 0, 6, 6))).toBe(2)
    expect(maxVerticalCells(rectAt(0, 0, 6, 9))).toBe(3)
    expect(maxVerticalCells(rectAt(0, 0, 6, 2))).toBe(0)
  })
})

describe('generateCells — determinism', () => {
  it('produces an identical layout for the same seed and side', () => {
    const b = rectAt(0, 0, 12, 12)
    const a1 = generateCells(b, 3, 's', SeededRng.fromNumber(7))
    const a2 = generateCells(b, 3, 's', SeededRng.fromNumber(7))
    expect(a1).toEqual(a2)
  })

  it('produces different layouts for different seeds', () => {
    const b = rectAt(0, 0, 12, 12)
    const a = generateCells(b, 3, 's', SeededRng.fromNumber(1))
    const c = generateCells(b, 3, 's', SeededRng.fromNumber(2))
    expect(a).not.toEqual(c)
  })
})

describe('generateCells — geometry', () => {
  const sides = ['n', 's', 'e', 'w'] as const

  it('keeps cells, bedPos, doors, walls, and corridor inside the building rect', () => {
    const b = rectAt(0, 0, 12, 12)
    for (const side of sides) {
      const layout = generateCells(b, 3, side, SeededRng.fromNumber(11))
      for (const cell of layout.cells) {
        expect(rectContains(b, cell.rect), `cell rect side=${side}`).toBe(true)
        expect(pointInRect(cell.bedPos, b), `bedPos side=${side}`).toBe(true)
        expect(rectContains(b, cell.doorRect), `door rect side=${side}`).toBe(true)
      }
      for (const w of layout.walls) {
        expect(rectContains(b, w), `wall side=${side}`).toBe(true)
      }
      expect(rectContains(b, layout.corridor), `corridor side=${side}`).toBe(true)
    }
  })

  it('puts each cell\'s bedPos inside that cell\'s rect', () => {
    const b = rectAt(0, 0, 12, 12)
    for (const side of sides) {
      const layout = generateCells(b, 3, side, SeededRng.fromNumber(22))
      for (const cell of layout.cells) {
        expect(pointInRect(cell.bedPos, cell.rect), `side=${side}`).toBe(true)
      }
    }
  })

  it('orients doors horizontally for n/s corridors and vertically for e/w', () => {
    const b = rectAt(0, 0, 12, 12)
    for (const side of ['n', 's'] as const) {
      const layout = generateCells(b, 3, side, SeededRng.fromNumber(33))
      for (const cell of layout.cells) {
        expect(cell.doorOrient).toBe('h')
      }
    }
    for (const side of ['e', 'w'] as const) {
      const layout = generateCells(b, 3, side, SeededRng.fromNumber(33))
      for (const cell of layout.cells) {
        expect(cell.doorOrient).toBe('v')
      }
    }
  })

  it('places corridor on the requested side of the building', () => {
    const b = rectAt(0, 0, 12, 12)
    const south = generateCells(b, 3, 's', SeededRng.fromNumber(44))
    const north = generateCells(b, 3, 'n', SeededRng.fromNumber(44))
    const west = generateCells(b, 3, 'w', SeededRng.fromNumber(44))
    const east = generateCells(b, 3, 'e', SeededRng.fromNumber(44))

    const cy = (r: Rect) => r.y + r.h / 2
    const cx = (r: Rect) => r.x + r.w / 2
    const bldgCy = cy(b)
    const bldgCx = cx(b)

    expect(cy(south.corridor)).toBeGreaterThan(bldgCy)
    expect(cy(north.corridor)).toBeLessThan(bldgCy)
    expect(cx(west.corridor)).toBeLessThan(bldgCx)
    expect(cx(east.corridor)).toBeGreaterThan(bldgCx)
  })

  it('emits the requested cell count', () => {
    const b = rectAt(0, 0, 12, 12)
    for (const side of sides) {
      for (const n of [1, 2, 3]) {
        const layout = generateCells(b, n, side, SeededRng.fromNumber(55))
        expect(layout.cells, `side=${side} n=${n}`).toHaveLength(n)
      }
    }
  })
})
