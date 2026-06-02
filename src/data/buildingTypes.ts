import json5 from 'json5'
import raw from './building-types.json5?raw'
import type { ObjectTemplateId } from './objectTemplates'

export type DoorSide = 'n' | 's' | 'e' | 'w'

export type ProcgenItemRole =
  | 'supervisor'    // 1 item, centered, near top wall (or above partition)
  | 'counter'       // N workstations stacked at supervisor position (different shifts)
  | 'worker'        // N items in auto-grid in lower zone
  | 'customer_row'  // N items in row below supervisor
  | 'bed_row'       // N items along south wall
  | 'amenity_row'   // N items along south wall, west-to-east; sits above bed_row when both present
  | 'queue'         // 1 item near primary door
  | 'shopCounter' | 'shopApproach' | 'shopEntry' | 'shopExit'  // shop landmark anchors

// ── Procgen items (open_floor / cells layouts) ──────────────────────────────
//
// All procgen items carry a `template` reference into objectTemplates.json5
// plus placement params relevant to the open_floor / cells algorithms. The
// spawn dispatcher resolves the template to figure out which traits to
// construct; this file only declares the placement intent.

export interface ProcgenPlacedItem {
  template: ObjectTemplateId
  role: ProcgenItemRole
  /** Bed rows and customer rows declare a count; other roles spawn one item. */
  count?: number
}

export interface ProcgenPartitionItem {
  template: ObjectTemplateId
  rowFromTop: number
  doorTiedToPrimary: boolean
}

export type ProcgenItem = ProcgenPlacedItem | ProcgenPartitionItem

// ── Crafted items (crafted layouts) ─────────────────────────────────────────
//
// Crafted items are placed at fixed relative-tile coordinates. workstation_grid
// is a special structural directive that references an array of templates (one
// per cell) rather than a single one.

export interface CraftedPlacedItem {
  template: ObjectTemplateId
  relTile: { x: number; y: number }
}

export interface CraftedWorkstationGridItem {
  type: 'workstation_grid'
  relTile: { x: number; y: number }
  cols: number
  rows: number
  colStride: number
  rowStride: number
  /** One template per grid cell, row-major (`cols * rows` entries). */
  templates: ObjectTemplateId[]
}

export type CraftedItem = CraftedPlacedItem | CraftedWorkstationGridItem

export function isWorkstationGrid(item: CraftedItem): item is CraftedWorkstationGridItem {
  return 'type' in item && item.type === 'workstation_grid'
}

// ── Layouts ─────────────────────────────────────────────────────────────────

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

// Cell-based interior. Corridor side is decided per-slot by the road
// procgen (it's whichever wall faces the chosen road), not baked here.
export type CellsLayout = {
  algorithm: 'cells'
  minCells: number
  maxCells: number
  cellItems: ProcgenItem[]
}

// Procgen airport: open interior with a single ticket counter centered
// against the wall opposite the primary door. Also registers the building
// with the FlightHub matched to the host scene's id (1:1 per scene).
export type AirportLayout = {
  algorithm: 'airport'
}

// Procgen transit terminal: open interior with a single transit kiosk
// centered against the wall opposite the primary door. Bound 1:1 by
// scene id to the matching `placement: 'building'` entry in transit.json5.
export type TransitLayout = {
  algorithm: 'transit'
}

// Orbital-lift vestibule: open interior with a single lift kiosk centered
// against the wall opposite the primary door. The kiosk is bound at spawn
// time to whichever orbital-lifts.json5 row lists this scene as one of its
// endpoints (one lift per scene at this slice). Same kiosk-in-vestibule
// shape as transit; the algorithm is split out so the spawner can resolve
// the lift row instead of a transit terminal row.
export type LiftLayout = {
  algorithm: 'lift'
}

// Park: an outdoor area with no exterior walls and no door. Random
// fixtures (taps, scavenge points, benches) scatter inside the rect.
// Spawn-time fixture counts are drawn uniformly from the per-kind ranges.
export type ParkLayout = {
  algorithm: 'park'
  taps:    { min: number; max: number }
  scavenge:{ min: number; max: number }
  benches: { min: number; max: number }
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
  | CellsLayout
  | AirportLayout
  | TransitLayout
  | LiftLayout
  | ParkLayout
  | CraftedLayout

type ProcgenSize = { minW: number; maxW: number; minH: number; maxH: number }
type FixedSize = { w: number; h: number }

export type BuildingType = {
  labelZh: string
  size: ProcgenSize | FixedSize
  // Per Design/social/diegetic-management.md the per-facility manage cell
  // is the legitimate cell-as-management surface for player-owned
  // facilities. When this flag is true, spawnBuilding emits an
  // Interactable({ kind: 'manage' }) at the building's center, linked
  // back to the building entity via ManageCell. The interaction system
  // gates activation on player ownership.
  hasManageCell?: boolean
  // Civic infrastructure that the city must run forever. When true, the
  // realtor never lists the building and any direct-seller close path
  // refuses the transfer — Owner stays 'state' for the run's lifetime.
  // See ownership.json5 for the spawn-time default ('state' is required;
  // the flag is meaningless on a faction- or private-owned facility).
  stateLocked?: boolean
  // Phase 6.3.C — facilities only buildable at colonies (not present in
  // established city scenes). Gated from city realtor listings because
  // no Building entity with this typeId will exist in a city world.
  colonyOnly?: boolean
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
