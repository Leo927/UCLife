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
