import { describe, expect, it } from 'vitest'
import { assignBuildings } from './blocks'
import { SeededRng } from './rng'
import type { SubBlock } from './roads'
import type { DistrictConfig } from '../data/scenes'

const TILE = 32

// apartment: minCells=3, each cell needs ≥3 tiles tall → building ≥9 tiles tall
// for vertical (east/west door) corridor orientation.
const APARTMENT_MIN_CELLS = 3
const VERTICAL_TILES_PER_CELL = 3
const APARTMENT_REQUIRED_H = APARTMENT_MIN_CELLS * VERTICAL_TILES_PER_CELL * TILE

// apartment: minCells=3, each cell needs ≥2 tiles wide → building ≥6 tiles wide
// for horizontal (north/south door) corridor orientation.
const HORIZONTAL_TILES_PER_CELL = 2
const APARTMENT_REQUIRED_W = APARTMENT_MIN_CELLS * HORIZONTAL_TILES_PER_CELL * TILE

const procgenRect = { x: 0, y: 0, w: 100, h: 100 }
const fullDistrict: DistrictConfig = {
  id: 'test',
  rect: { x: 0, y: 0, w: 100, h: 100 },
  types: [{ id: 'apartment' }],
}

function subBlockWithEastDoor(wTiles = 20, hTiles = 20): SubBlock {
  return {
    rect: { x: 0, y: 0, w: wTiles * TILE, h: hTiles * TILE },
    adjacentRoads: [{ side: 'e', kind: 'street' }],
  }
}

function subBlockWithSouthDoor(wTiles = 20, hTiles = 20): SubBlock {
  return {
    rect: { x: 0, y: 0, w: wTiles * TILE, h: hTiles * TILE },
    adjacentRoads: [{ side: 's', kind: 'street' }],
  }
}

describe('assignBuildings — apartment cell sizing', () => {
  it('never places an apartment too short for minCells on a vertical-corridor (east door) sub-block', () => {
    // Bug: fitBuilding checked effMaxH >= minCells*3 but then picked
    // h from [minH..effMaxH] where minH=5 < 9=minCells*3, yielding
    // apartments too short to host any cells → spawnCells returns early,
    // leaving the building completely empty.
    const sb = subBlockWithEastDoor()
    for (let seed = 0; seed < 50; seed++) {
      const buildings = assignBuildings(procgenRect, [sb], [fullDistrict], SeededRng.fromNumber(seed))
      for (const b of buildings) {
        if (b.typeId === 'apartment') {
          expect(
            b.slot.rect.h,
            `seed=${seed}: apartment height ${b.slot.rect.h / TILE} tiles < required ${APARTMENT_REQUIRED_H / TILE} tiles`,
          ).toBeGreaterThanOrEqual(APARTMENT_REQUIRED_H)
        }
      }
    }
  })

  it('never places an apartment too narrow for minCells on a horizontal-corridor (south door) sub-block', () => {
    const sb = subBlockWithSouthDoor()
    for (let seed = 0; seed < 50; seed++) {
      const buildings = assignBuildings(procgenRect, [sb], [fullDistrict], SeededRng.fromNumber(seed))
      for (const b of buildings) {
        if (b.typeId === 'apartment') {
          expect(
            b.slot.rect.w,
            `seed=${seed}: apartment width ${b.slot.rect.w / TILE} tiles < required ${APARTMENT_REQUIRED_W / TILE} tiles`,
          ).toBeGreaterThanOrEqual(APARTMENT_REQUIRED_W)
        }
      }
    }
  })
})

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x
    && a.y < b.y + b.h && a.y + a.h > b.y
}

function rectInside(
  inner: { x: number; y: number; w: number; h: number },
  outer: { x: number; y: number; w: number; h: number },
): boolean {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w
    && inner.y + inner.h <= outer.y + outer.h
}

describe('assignBuildings — buildingsPerBlockMax', () => {
  // 30×16-tile sub-block — wide enough to host several apartment frontages
  // (apartment minW = 8 along a south-door wall) side by side.
  const wideSouthSb: SubBlock = {
    rect: { x: 0, y: 0, w: 30 * TILE, h: 16 * TILE },
    adjacentRoads: [{ side: 's', kind: 'street' }],
  }

  it('packs more than one building when buildingsPerBlockMax > 1', () => {
    const district: DistrictConfig = {
      id: 'test',
      rect: { x: 0, y: 0, w: 100, h: 100 },
      types: [{ id: 'apartment' }],
      buildingsPerBlockMax: 4,
    }
    let sawMultiple = false
    for (let seed = 0; seed < 30; seed++) {
      const buildings = assignBuildings(
        procgenRect, [wideSouthSb], [district], SeededRng.fromNumber(seed),
      )
      if (buildings.length > 1) sawMultiple = true
      // Every building stays inside the sub-block.
      for (const b of buildings) {
        expect(rectInside(b.slot.rect, wideSouthSb.rect), `seed=${seed} inside`).toBe(true)
      }
      // No two buildings in the same sub-block overlap.
      for (let i = 0; i < buildings.length; i++) {
        for (let j = i + 1; j < buildings.length; j++) {
          expect(
            rectsOverlap(buildings[i].slot.rect, buildings[j].slot.rect),
            `seed=${seed} buildings ${i}/${j} overlap`,
          ).toBe(false)
        }
      }
    }
    expect(sawMultiple, 'buildingsPerBlockMax=4 should produce >1 building on at least one seed').toBe(true)
  })

  it('still places exactly one building per sub-block when buildingsPerBlockMax is unset (default 1)', () => {
    const district: DistrictConfig = {
      id: 'test',
      rect: { x: 0, y: 0, w: 100, h: 100 },
      types: [{ id: 'apartment' }],
    }
    for (let seed = 0; seed < 20; seed++) {
      const buildings = assignBuildings(
        procgenRect, [wideSouthSb], [district], SeededRng.fromNumber(seed),
      )
      expect(buildings.length, `seed=${seed}`).toBeLessThanOrEqual(1)
    }
  })
})
