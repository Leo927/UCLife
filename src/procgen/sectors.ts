// The slot grid (positions, sizes, door sides) is fixed; per-seed variation
// is limited to (1) shuffling service-category roles across the 3 top-row
// slots and (2) picking each slot's exterior-door offset along its
// prescribed wall. Work + housing roles are size-locked because their
// corridor orientation must match the slot's door side.

import type { SeededRng } from './rng'
import { worldConfig } from '../config'

const TILE = worldConfig.tilePx

export type DoorSide = 'n' | 's' | 'e' | 'w'

export type BuildingRole =
  | 'apartment' | 'luxury' | 'dorm' | 'flop'
  | 'factory' | 'shop'
  | 'bar' | 'hr' | 'aptOffice'
  | 'aeComplex'

export type SlotRect = { x: number; y: number; w: number; h: number }

export type DoorPlacement = {
  side: DoorSide
  // Offset along the wall (top→bottom or left→right).
  offsetPx: number
  widthPx: number
}

export type PlacedSlot = {
  rect: SlotRect
  primaryDoor: DoorPlacement
  extraDoors: DoorPlacement[]
}

// Door side is fixed because the building's interior layout assumes it
// (e.g. apartment cells run with corridor on the south → exterior door
// must face south).
type ExtraDoorSpec = {
  side: DoorSide
  // When set, the extra door's offset tracks the primary's so n+s exterior
  // doors and the interior partition door line up vertically (factory).
  tiedToPrimary?: boolean
  offsetTiles?: number
}

type SlotSpec = {
  role: BuildingRole
  tileX: number
  tileY: number
  tileW: number
  tileH: number
  doorSide: DoorSide
  // Default range is [1, wallTiles-2] (1-tile margin from corners).
  doorOffsetMinTiles?: number
  doorOffsetMaxTiles?: number
  extraDoors?: ExtraDoorSpec[]
}

const SLOT_SPECS: SlotSpec[] = [
  { role: 'bar',       tileX: 3,  tileY: 1, tileW: 6, tileH: 4, doorSide: 's' },
  { role: 'hr',        tileX: 15, tileY: 1, tileW: 6, tileH: 4, doorSide: 's' },
  { role: 'aptOffice', tileX: 27, tileY: 1, tileW: 6, tileH: 4, doorSide: 's' },
  {
    role: 'aeComplex', tileX: 400, tileY: 200, tileW: 28, tileH: 26,
    doorSide: 'w',
    // Constrain to the reception strip (rows 14-22 inside the building) so
    // the exterior door always opens onto the lobby reception.
    doorOffsetMinTiles: 14,
    doorOffsetMaxTiles: 22,
  },

  // Factory has two exterior doors (north into manager office, south into
  // floor) tied so traffic flows straight through.
  {
    role: 'factory', tileX: 3, tileY: 7, tileW: 8, tileH: 10,
    doorSide: 'n',
    extraDoors: [{ side: 's', tiedToPrimary: true }],
  },
  // One-way shop traffic: north entry, south exit, splits the cashier-line
  // bottleneck. Enforced behaviorally via the shopEntry/shopExit landmarks
  // and isInsideShop() in ai/agent.ts.
  {
    role: 'shop', tileX: 30, tileY: 7, tileW: 7, tileH: 5, doorSide: 's',
    extraDoors: [{ side: 'n', offsetTiles: 1 }],
  },

  { role: 'apartment', tileX: 15, tileY: 8,  tileW: 9, tileH: 7, doorSide: 's' },
  // Needs ≥ 9 tiles tall for 3 cells of min-3-tile height each.
  { role: 'luxury',    tileX: 28, tileY: 14, tileW: 9, tileH: 10, doorSide: 'w' },
  { role: 'dorm',      tileX: 3,  tileY: 19, tileW: 7, tileH: 5, doorSide: 'e' },
  { role: 'flop',      tileX: 15, tileY: 18, tileW: 6, tileH: 4, doorSide: 'n' },
]

// Roles shuffled across the matching slot pool rather than placed 1:1.
const SERVICE_ROLES: BuildingRole[] = ['bar', 'hr', 'aptOffice']

function wallLengthTiles(spec: SlotSpec, side: DoorSide): number {
  return (side === 'n' || side === 's') ? spec.tileW : spec.tileH
}

// Fisher–Yates in place.
function shuffle<T>(arr: T[], rng: SeededRng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.intRange(0, i)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function pickDoorOffsetTiles(spec: SlotSpec, side: DoorSide, rng: SeededRng): number {
  const wallTiles = wallLengthTiles(spec, side)
  const min = spec.doorOffsetMinTiles ?? 1
  const max = spec.doorOffsetMaxTiles ?? wallTiles - 2
  if (max < min) return min
  return rng.intRange(min, max)
}

function buildPlaced(spec: SlotSpec, rng: SeededRng): PlacedSlot {
  const rect: SlotRect = {
    x: spec.tileX * TILE,
    y: spec.tileY * TILE,
    w: spec.tileW * TILE,
    h: spec.tileH * TILE,
  }
  const primaryOffsetTiles = pickDoorOffsetTiles(spec, spec.doorSide, rng)
  const primaryDoor: DoorPlacement = {
    side: spec.doorSide,
    offsetPx: primaryOffsetTiles * TILE,
    widthPx: TILE,
  }
  const extraDoors: DoorPlacement[] = (spec.extraDoors ?? []).map((d) => {
    const offsetTiles = d.tiedToPrimary
      ? primaryOffsetTiles
      : (d.offsetTiles ?? 1)
    return { side: d.side, offsetPx: offsetTiles * TILE, widthPx: TILE }
  })
  return { rect, primaryDoor, extraDoors }
}

export type SectorLayout = {
  slots: Map<BuildingRole, PlacedSlot>
}

// RNG draws happen in a fixed order — service shuffle first, then one
// offset per role in fixed iteration order — so the same seed reproduces
// the same layout.
export function generateSectors(rng: SeededRng): SectorLayout {
  const shuffledServices = shuffle([...SERVICE_ROLES], rng)
  const serviceSlotSpecs = SLOT_SPECS.filter((s) => SERVICE_ROLES.includes(s.role))
  const serviceAssignment = new Map<BuildingRole, SlotSpec>()
  serviceSlotSpecs.forEach((spec, i) => {
    serviceAssignment.set(shuffledServices[i], spec)
  })

  const slots = new Map<BuildingRole, PlacedSlot>()
  for (const role of [
    'apartment', 'luxury', 'dorm', 'flop',
    'factory', 'shop',
    'bar', 'hr', 'aptOffice',
    'aeComplex',
  ] as BuildingRole[]) {
    const spec = SERVICE_ROLES.includes(role)
      ? serviceAssignment.get(role)!
      : SLOT_SPECS.find((s) => s.role === role)!
    slots.set(role, buildPlaced(spec, rng))
  }
  return { slots }
}
