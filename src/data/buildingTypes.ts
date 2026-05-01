import json5 from 'json5'
import raw from './building-types.json5?raw'

export type DoorSide = 'n' | 's' | 'e' | 'w'

export type ProcgenItemRole =
  | 'supervisor'    // 1 item, centered, near top wall (or above partition)
  | 'counter'       // N workstations stacked at supervisor position (different shifts)
  | 'worker'        // N items in auto-grid in lower zone
  | 'customer_row'  // N items in row below supervisor
  | 'bed_row'       // N items along south wall
  | 'queue'         // 1 item near primary door

export type ProcgenWorkstationItem = {
  type: 'workstation'
  specId?: string
  specIds?: string[]
  role: ProcgenItemRole
  kind?: string
  labelZh?: string
  noInteractable?: boolean
}

export type ProcgenBedItem = {
  type: 'bed'
  tier: 'flop' | 'dorm' | 'apartment' | 'luxury' | 'lounge'
  role: 'bed_row'
  count?: number
}

export type ProcgenBarSeatItem = {
  type: 'bar_seat'
  role: 'customer_row'
  count: number
}

export type ProcgenQueueItem = {
  type: 'queue_point'
  role: 'queue'
}

export type ProcgenLandmarkItem = {
  type: 'landmark'
  role: 'shop_counter' | 'shop_approach' | 'shop_entry' | 'shop_exit'
}

export type ProcgenPartitionItem = {
  type: 'partition'
  orientation: 'h'
  rowFromTop: number
  doorTiedToPrimary: boolean
}

export type ProcgenItem =
  | ProcgenWorkstationItem
  | ProcgenBedItem
  | ProcgenBarSeatItem
  | ProcgenQueueItem
  | ProcgenLandmarkItem
  | ProcgenPartitionItem

export type CraftedWorkstationItem = {
  type: 'workstation'
  specId: string
  relTile: { x: number; y: number }
  kind?: string
  labelZh?: string
}

export type CraftedWorkstationGridItem = {
  type: 'workstation_grid'
  relTile: { x: number; y: number }
  cols: number
  rows: number
  colStride: number
  rowStride: number
  specIds: string[]
}

export type CraftedBedItem = {
  type: 'bed'
  tier: 'flop' | 'dorm' | 'apartment' | 'luxury' | 'lounge'
  relTile: { x: number; y: number }
}

export type CraftedGymItem = {
  type: 'gym_equipment'
  labelZh: string
  relTile: { x: number; y: number }
}

export type CraftedSnackItem = {
  type: 'snack_cabinet'
  relTile: { x: number; y: number }
}

export type CraftedWaterItem = {
  type: 'water_dispenser'
  relTile: { x: number; y: number }
}

export type CraftedItem =
  | CraftedWorkstationItem
  | CraftedWorkstationGridItem
  | CraftedBedItem
  | CraftedGymItem
  | CraftedSnackItem
  | CraftedWaterItem

type ExtraDoorSpec = {
  side: DoorSide
  tiedToPrimary?: boolean
}

export type OpenFloorLayout = {
  algorithm: 'open_floor'
  primaryDoor?: DoorSide
  extraDoors?: ExtraDoorSpec[]
  items: ProcgenItem[]
}

export type HorizontalCellsLayout = {
  algorithm: 'horizontal_cells'
  minCells: number
  maxCells: number
  cellItems: ProcgenItem[]
}

export type VerticalCellsLayout = {
  algorithm: 'vertical_cells'
  minCells: number
  maxCells: number
  cellItems: ProcgenItem[]
}

export type InternalWall = {
  relPixel: { x: number; y: number }
  sizePx: { w: number; h: number }
}

export type FactionGate = {
  relPixel: { x: number; y: number }
  sizePx: { w: number; h: number }
  orient: 'h' | 'v'
  faction: string
}

type CraftedDoorSpec = {
  side: DoorSide
  offsetTiles?: number
  offsetMinTiles?: number
  offsetMaxTiles?: number
}

export type CraftedLayout = {
  algorithm: 'crafted'
  doors: CraftedDoorSpec[]
  internalWalls?: InternalWall[]
  factionGates?: FactionGate[]
  items: CraftedItem[]
}

export type BuildingLayout =
  | OpenFloorLayout
  | HorizontalCellsLayout
  | VerticalCellsLayout
  | CraftedLayout

type ProcgenSize = { minW: number; maxW: number; minH: number; maxH: number }
type FixedSize = { w: number; h: number }

export type BuildingType = {
  labelZh: string
  size: ProcgenSize | FixedSize
}  & { layout: BuildingLayout }

export function isFixedSize(s: ProcgenSize | FixedSize): s is FixedSize {
  return 'w' in s
}

const parsed = json5.parse(raw) as Record<string, BuildingType>

export const buildingTypes: Readonly<Record<string, BuildingType>> = parsed

export function getBuildingType(id: string): BuildingType {
  const t = buildingTypes[id]
  if (!t) throw new Error(`Unknown building type: "${id}"`)
  return t
}
