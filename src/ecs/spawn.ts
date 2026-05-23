import type { Entity, World } from 'koota'
import { world, setActiveSceneId, getWorld, SCENE_IDS, type SceneId } from './world'
import {
  scenes, initialSceneId,
  type SceneConfig, type MicroSceneConfig, type ShipSceneConfig,
} from '../data/scenes'
import {
  Position, Interactable, Building, Owner, Facility,
  Job, Workstation, Recruiter, ManageCell,
  Bed, Wall, Door, BarSeat, RoughSpot,
  EntityKey, Transit,
  FlightHub, Road,
  Ship, ShipRoom, WeaponMount, IsFlagshipMark, IsInActiveFleet,
  Hangar, OrbitalLift, TemplateRef,
  type InteractableKind,
} from './traits'
import {
  getObjectTemplate,
  type ObjectTemplateId, type WorkstationTemplate, type BedTemplate,
  type BarSeatTemplate, type InteractableTemplate,
} from '../data/objectTemplates'
import { getHangarFacilityType } from '../data/facilityTypes'
import { liftsForScene, liftFareFrom } from '../data/orbitalLifts'
import { bootstrapFactions, defaultOwnerFor, seedPrivateOwners } from './ownership'
import { spawnNPC, spawnPlayer, type NPCSpec } from '../character/spawn'
import { getShipClass, type ShipClassDef } from '../data/ship-classes'
import { getWeapon } from '../data/weapons'
import { transitTerminals } from '../data/transit'
import { flightHubs } from '../data/flights'
import { setAirportPlacement, clearAirportPlacements } from '../sim/airportPlacements'
import { setTransitPlacement, clearTransitPlacements } from '../sim/transitPlacements'
import { bootstrapSpaceCampaign } from '../sim/spaceBootstrap'
import { attachShipStatSheet } from './shipEffects'
import { defaultShipName } from '../data/shipNaming'
import { specialNpcs } from '../character/specialNpcs'
import { pickFreshName, pickRandomColor } from '../character/nameGen'
import type { FactionId } from '../data/factions'
import { markPathfindingDirty } from '../systems/pathfinding'
import { worldConfig, economyConfig, fleetConfig } from '../config'
import {
  SeededRng, generateCells, maxHorizontalCells, maxVerticalCells,
  generateRoadGrid, assignBuildings,
} from '../procgen'
import { placeFixedBuilding } from '../procgen/slots'
import type { DoorPlacement, DoorSide, PlacedSlot } from '../procgen/slots'
import { layoutOpenFloorItems, findPartition } from '../procgen/itemLayout'
import { layoutShipInterior } from '../procgen/ship'
import {
  getBuildingType, isWorkstationGrid,
  type CraftedItem, type ProcgenPlacedItem,
  type OpenFloorLayout, type CellsLayout, type CraftedLayout, type ParkLayout,
} from '../data/buildingTypes'
import type { TransitTerminal, TransitPlacementKind } from '../data/transit'
import { setLandmark, clearLandmarks, addRoughSource, setShopRect } from '../data/landmarks'
import { resetAll } from '../save/registry'
import { bootstrapWorldSingleton } from './resources'

const TILE = worldConfig.tilePx
const WALL_T = worldConfig.wallThicknessPx

// ── Trait spawn helpers ─────────────────────────────────────────────────────
//
// Every world object gets a TemplateRef pointing at its authored
// template id in `object-templates.json5`. These wrappers keep the
// trait set + template binding co-located so call sites can't drift.

function spawnWallEntity(args: { x: number; y: number; w: number; h: number }): Entity {
  return world.spawn(
    Wall(args),
    TemplateRef({ id: 'wall-default' }),
  )
}

function spawnDoorEntity(args: {
  x: number; y: number; w: number; h: number
  orient: 'h' | 'v'
  bedEntity?: Entity | null
  factionGate?: FactionId | null
}): Entity {
  const templateId: ObjectTemplateId = args.factionGate
    ? 'door-faction-gated'
    : args.bedEntity
      ? 'door-bed-keyed'
      : 'door-open'
  return world.spawn(
    Position({ x: args.x + args.w / 2, y: args.y + args.h / 2 }),
    Door({
      x: args.x, y: args.y, w: args.w, h: args.h, orient: args.orient,
      bedEntity: args.bedEntity ?? null,
      factionGate: args.factionGate ?? null,
    }),
    TemplateRef({ id: templateId }),
  )
}

// ── EXTERIOR WALL + DOOR SPAWNER ─────────────────────────────────────────────

function enclose(b: { x: number; y: number; w: number; h: number }, doors: DoorPlacement[]) {
  const { x, y, w, h } = b
  const cuts: Record<'n' | 's' | 'e' | 'w', { from: number; to: number }[]> = {
    n: [], s: [], e: [], w: [],
  }
  for (const d of doors) {
    const dw = d.widthPx
    cuts[d.side].push({ from: d.offsetPx, to: d.offsetPx + dw })
    const orient: 'h' | 'v' = (d.side === 'n' || d.side === 's') ? 'h' : 'v'
    let dx: number, dy: number, dwPx: number, dhPx: number
    if (d.side === 'n') { dx = x + d.offsetPx; dy = y; dwPx = dw; dhPx = WALL_T }
    else if (d.side === 's') { dx = x + d.offsetPx; dy = y + h - WALL_T; dwPx = dw; dhPx = WALL_T }
    else if (d.side === 'w') { dx = x; dy = y + d.offsetPx; dwPx = WALL_T; dhPx = dw }
    else                     { dx = x + w - WALL_T; dy = y + d.offsetPx; dwPx = WALL_T; dhPx = dw }
    spawnDoorEntity({ x: dx, y: dy, w: dwPx, h: dhPx, orient })
  }

  function buildEdge(side: 'n' | 's' | 'e' | 'w') {
    const horiz = side === 'n' || side === 's'
    const length = horiz ? w : h
    const cs = cuts[side].slice().sort((a, b) => a.from - b.from)
    let cursor = 0
    const segments: [number, number][] = []
    for (const c of cs) {
      if (c.from > cursor) segments.push([cursor, c.from])
      cursor = Math.max(cursor, c.to)
    }
    if (cursor < length) segments.push([cursor, length])
    for (const [a, b] of segments) {
      const len = b - a
      if (len <= 0) continue
      let wx: number, wy: number, ww: number, wh: number
      if (side === 'n')      { wx = x + a; wy = y; ww = len; wh = WALL_T }
      else if (side === 's') { wx = x + a; wy = y + h - WALL_T; ww = len; wh = WALL_T }
      else if (side === 'w') { wx = x; wy = y + a; ww = WALL_T; wh = len }
      else                   { wx = x + w - WALL_T; wy = y + a; ww = WALL_T; wh = len }
      spawnWallEntity({ x: wx, y: wy, w: ww, h: wh })
    }
  }
  buildEdge('n'); buildEdge('s'); buildEdge('w'); buildEdge('e')
}

// ── GENERIC BUILDING SPAWNER ─────────────────────────────────────────────────

// Building EntityKey is `bld-<sceneId>-<typeId>-<n>`, where n increments per
// (scene, type) tuple. Stable across runs for a given seed because the
// procgen + fixed-spawn order is deterministic. The realtor's listings and
// the Owner serializer both round-trip through this key.
const buildingKeyCounters: Record<string, number> = {}
function nextBuildingKey(sceneId: SceneId, typeId: string): string {
  const k = `${sceneId}:${typeId}`
  const n = buildingKeyCounters[k] ?? 0
  buildingKeyCounters[k] = n + 1
  return `bld-${sceneId}-${typeId}-${n}`
}

function spawnBuilding(typeId: string, slot: PlacedSlot, rng: SeededRng, sceneId: SceneId): Entity {
  const btype = getBuildingType(typeId)
  const buildingKey = nextBuildingKey(sceneId, typeId)
  const buildingEnt = world.spawn(
    Building({ ...slot.rect, label: btype.labelZh, typeId }),
    Owner(defaultOwnerFor(world, typeId)),
    Facility({
      revenueAcc: 0, salariesAcc: 0, insolventDays: 0,
      lastRolloverDay: 0, closedSinceDay: 0, closedReason: null,
    }),
    EntityKey({ key: buildingKey }),
  )

  const layout = btype.layout
  // Park has no exterior walls and no doors — skip enclose entirely.
  if (layout.algorithm !== 'park') {
    enclose(slot.rect, [slot.primaryDoor, ...slot.extraDoors])
  }

  switch (layout.algorithm) {
    case 'open_floor':  spawnOpenFloor(layout, slot); break
    case 'cells':       spawnCells(typeId, layout, slot, rng); break
    case 'airport':     spawnAirport(slot, sceneId); break
    case 'transit':     spawnTransitBuilding(slot, sceneId); break
    case 'lift':        spawnLiftBuilding(slot, sceneId); break
    case 'park':        spawnPark(layout, slot, rng); break
    case 'crafted':     spawnCrafted(layout, slot, rng); break
  }

  // Per Design/social/diegetic-management.md: per-facility manage cell
  // for player-ownable types. The cell sits at the building's center
  // tile so it is reachable from any layout without per-type tuning.
  // The interaction system gates the verb on player ownership; an
  // unowned manage cell is inert (no verb surface, no toast).
  if (btype.hasManageCell) {
    world.spawn(
      Position({ x: slot.rect.x + slot.rect.w / 2, y: slot.rect.y + slot.rect.h / 2 }),
      Interactable({ kind: 'manage', label: `管理 · ${btype.labelZh}` }),
      ManageCell({ building: buildingEnt }),
      EntityKey({ key: `manage-${buildingKey}` }),
      TemplateRef({ id: 'manage-cell' }),
    )
  }
  // Building outline reuses a single template — the rect comes from
  // the Building trait, only the palette is template-owned.
  buildingEnt.add(TemplateRef({ id: 'building-outline' }))

  // Phase 6.2.A — hangar facility-class augmentation. Attaches the
  // tier + slotCapacity from facility-types.json5 onto the building
  // entity so the manager's talk-verb can read capacity counts off a
  // single trait without re-deriving from typeId.
  //
  // Phase 6.2.F — supply / fuel reserves project from the same row.
  // Spawn-time `supplyCurrent` / `fuelCurrent` start at the full cap
  // (state hangars open stocked; player-owned hangars match because
  // the initial transfer-in happens off-screen during procurement).
  const hangarFacility = getHangarFacilityType(typeId)
  if (hangarFacility) {
    buildingEnt.add(Hangar({
      tier: hangarFacility.tier,
      slotCapacity: hangarFacility.slotCapacity,
      repairPriorityShipKey: '',
      pendingDeliveries: [],
      supplyCurrent: hangarFacility.supplyStorage,
      supplyMax: hangarFacility.supplyStorage,
      fuelCurrent: hangarFacility.fuelStorage,
      fuelMax: hangarFacility.fuelStorage,
      pendingSupplyDeliveries: [],
    }))
  }

  // Per the worker-not-workstation rule the former 'buyShip' kiosk is
  // gone — ship purchase now routes via the AE director's talk-verb
  // (ShipDealerConversation rendered in NPCDialog when ae_director is
  // on duty). See Design/social/diegetic-management.md.

  return buildingEnt
}

// Point one tile outside `door`, in the direction perpendicular to its wall.
// Used for shop entry/exit landmarks regardless of the rotated door side.
function outsideDoorPoint(
  rect: { x: number; y: number; w: number; h: number },
  door: DoorPlacement,
): { x: number; y: number } {
  if (door.side === 'n') return { x: rect.x + door.offsetPx + door.widthPx / 2, y: rect.y - TILE }
  if (door.side === 's') return { x: rect.x + door.offsetPx + door.widthPx / 2, y: rect.y + rect.h + TILE }
  if (door.side === 'w') return { x: rect.x - TILE, y: rect.y + door.offsetPx + door.widthPx / 2 }
  return { x: rect.x + rect.w + TILE, y: rect.y + door.offsetPx + door.widthPx / 2 }
}

// ── OPEN FLOOR ───────────────────────────────────────────────────────────────

function spawnOpenFloor(layout: OpenFloorLayout, slot: PlacedSlot): void {
  const { rect, primaryDoor, extraDoors } = slot

  // Spawn partition (if any) and compute its Y for zone splitting.
  let partitionY: number | null = null
  const partItem = findPartition(layout.items)
  if (partItem) {
    partitionY = rect.y + partItem.rowFromTop * TILE
    const doorOffsetPx = partItem.doorTiedToPrimary
      ? primaryDoor.offsetPx
      : Math.floor(rect.w / TILE / 2) * TILE
    spawnWallEntity({ x: rect.x, y: partitionY, w: doorOffsetPx, h: WALL_T })
    spawnWallEntity({
      x: rect.x + doorOffsetPx + TILE,
      y: partitionY,
      w: rect.w - doorOffsetPx - TILE,
      h: WALL_T,
    })
    spawnDoorEntity({ x: rect.x + doorOffsetPx, y: partitionY, w: TILE, h: WALL_T, orient: 'h' })
  }

  const placedItems = layoutOpenFloorItems(rect, primaryDoor, layout.items, partitionY)
  const counters: Record<string, number> = {}
  let counterPos: { x: number; y: number } | undefined

  // Workers whose supervisor is the factory manager get their hires
  // routed through the manager's desk (FactoryManagerConversation
  // talk-verb). Templates flag the hub via `factoryManagerHub: true`;
  // we collect refs in pass 1, link in pass 2.
  let managerStation: Entity | null = null
  const workerStations: Entity[] = []
  let hasBarSeats = false
  let hasShopLandmarks = false

  for (const pi of placedItems) {
    const template = getObjectTemplate(pi.item.template)
    if (template.kind === 'workstation') {
      if ((pi.item.role === 'supervisor' || pi.item.role === 'counter') && counterPos === undefined) {
        counterPos = { x: pi.x, y: pi.y }
      }
    } else if (template.kind === 'bar_seat') {
      hasBarSeats = true
    } else if (template.kind === 'landmark') {
      hasShopLandmarks = true
    }

    const ent = spawnProcgenItem(pi, counters)
    if (ent && template.kind === 'workstation') {
      if (pi.item.role === 'supervisor' && template.factoryManagerHub) {
        managerStation = ent
      } else if (pi.item.role === 'worker') {
        workerStations.push(ent)
      }
    }
  }

  if (managerStation) {
    for (const w of workerStations) {
      const cur = w.get(Workstation)!
      w.set(Workstation, { ...cur, managerStation })
    }
  }

  // Shop setup: shop_rect + 4 landmarks derived from door/counter positions.
  // The landmark templates declare which named landmark to register; we
  // resolve the position from door/counter geometry rather than the item's
  // placeholder coords (procgen layout doesn't compute landmark positions).
  if (hasShopLandmarks) {
    setShopRect(rect)
    if (counterPos) {
      setLandmark('shopCounter', counterPos)
      setLandmark('shopApproach', { x: counterPos.x, y: counterPos.y + TILE })
    }
    const entryDoor = extraDoors[0]
    if (entryDoor) setLandmark('shopEntry', outsideDoorPoint(rect, entryDoor))
    setLandmark('shopExit', outsideDoorPoint(rect, primaryDoor))
  }

  // Bar setup: barCounter landmark from the supervisor workstation position.
  if (hasBarSeats && counterPos) {
    setLandmark('barCounter', counterPos)
  }
}

function spawnProcgenItem(
  pi: { x: number; y: number; item: ProcgenPlacedItem },
  counters: Record<string, number>,
): Entity | null {
  const { x, y, item } = pi
  const template = getObjectTemplate(item.template)

  switch (template.kind) {
    case 'workstation':
      return spawnWorkstation(item.template, template, { x, y })
    case 'bar_seat':
      return spawnBarSeat(item.template, template, { x, y }, counters)
    case 'bed':
      return spawnBed(item.template, template, { x, y }, counters)
    case 'queue_point':
      setLandmark(template.landmarkRole, { x, y })
      return null
    case 'landmark':
      // Position resolved by spawnOpenFloor's geometry walk; nothing to do here.
      return null
    case 'partition':
      return null
    case 'interactable':
      return spawnInteractable(item.template, template, { x, y })
    case 'wall':
    case 'door':
    case 'building_outline':
      // Structural templates aren't valid procgen items; building-types
      // can't declare them and the layout dispatcher never produces them.
      return null
  }
}

// ── Template → entity instantiation helpers ────────────────────────────────

function spawnWorkstation(
  templateId: ObjectTemplateId,
  template: WorkstationTemplate,
  pos: { x: number; y: number },
): Entity {
  const traits = template.interactableKind === null
    ? [
        Position(pos),
        Workstation({ specId: template.specId, occupant: null }),
        EntityKey({ key: `ws-${template.specId}` }),
        TemplateRef({ id: templateId }),
      ]
    : [
        Position(pos),
        Interactable({ kind: template.interactableKind, label: template.labelZh ?? '工位' }),
        Workstation({ specId: template.specId, occupant: null }),
        EntityKey({ key: `ws-${template.specId}` }),
        TemplateRef({ id: templateId }),
      ]
  const ent = world.spawn(...traits)
  if (template.addRecruiterTrait) ent.add(Recruiter)
  return ent
}

function spawnBarSeat(
  templateId: ObjectTemplateId,
  template: BarSeatTemplate,
  pos: { x: number; y: number },
  counters: Record<string, number>,
): Entity {
  const idx = counters[templateId] ?? 0
  counters[templateId] = idx + 1
  return world.spawn(
    Position(pos),
    Interactable({ kind: 'bar', label: template.labelZh, fee: template.fee }),
    BarSeat({ occupant: null }),
    EntityKey({ key: `barseat-${idx}` }),
    TemplateRef({ id: templateId }),
  )
}

function spawnBed(
  templateId: ObjectTemplateId,
  template: BedTemplate,
  pos: { x: number; y: number },
  counters: Record<string, number>,
): Entity {
  const tier = template.tier
  const rent = bedRent(tier)
  const idx = counters[templateId] ?? 0
  counters[templateId] = idx + 1
  return world.spawn(
    Position(pos),
    Interactable({ kind: 'sleep', label: bedLabel(tier), fee: rent }),
    Bed({ tier, nightlyRent: rent, occupant: null, rentPaidUntilMs: 0 }),
    EntityKey({ key: `bed-${tier}-${idx}` }),
    TemplateRef({ id: templateId }),
  )
}

function spawnInteractable(
  templateId: ObjectTemplateId,
  template: InteractableTemplate,
  pos: { x: number; y: number },
): Entity {
  return world.spawn(
    Position(pos),
    Interactable({
      kind: template.interactableKind,
      label: template.labelZh,
      fee: template.fee ?? 0,
    }),
    TemplateRef({ id: templateId }),
  )
}

// ── CELL ALGORITHM ───────────────────────────────────────────────────────────

// One cell-based interior generator handles all four corridor orientations.
// `corridorSide` is the building's primary door side — the corridor runs
// along that wall, cells stack against the opposite wall, and each cell's
// internal door opens onto the corridor.
function spawnCells(typeId: string, layout: CellsLayout, slot: PlacedSlot, rng: SeededRng): void {
  const { rect, primaryDoor } = slot
  const corridorSide: DoorSide = primaryDoor.side
  const horizontal = corridorSide === 'n' || corridorSide === 's'
  const maxByDim = horizontal ? maxHorizontalCells(rect) : maxVerticalCells(rect)
  // assignBuildings's fitBuilding guarantees minCells fits, but defend
  // anyway: if upstream ever places a too-small cell building, fall back
  // to as many cells as fit instead of crashing distribute().
  if (maxByDim < layout.minCells) return
  const cellCount = rng.intRange(layout.minCells, Math.min(layout.maxCells, maxByDim))
  const cellLayout = generateCells(rect, cellCount, corridorSide, rng)

  const beds = cellLayout.cells.map((c, i) => {
    const item = layout.cellItems[0]
    if (!item || !('role' in item)) return null
    const template = getObjectTemplate(item.template)
    if (template.kind !== 'bed') return null
    const tier = template.tier
    const rent = bedRent(tier)
    return world.spawn(
      Position({ x: c.bedPos.x, y: c.bedPos.y }),
      Interactable({ kind: 'sleep', label: bedLabel(tier), fee: rent }),
      Bed({ tier, nightlyRent: rent, occupant: null, rentPaidUntilMs: 0 }),
      EntityKey({ key: `bed-${typeId}-${i}` }),
      TemplateRef({ id: item.template }),
    )
  })

  for (const w of cellLayout.walls) spawnWallEntity(w)
  cellLayout.cells.forEach((c, i) => {
    const dr = c.doorRect
    spawnDoorEntity({ ...dr, orient: c.doorOrient, bedEntity: beds[i] ?? null })
  })

  // Apartment-style buildings (horizontal corridor, ≥3 cells) get a
  // washstand at the far end of the corridor. Skip for luxury (vertical
  // corridor — no good free spot).
  if (horizontal) {
    world.spawn(
      Position({
        x: cellLayout.corridor.x + cellLayout.corridor.w - TILE / 2,
        y: cellLayout.corridor.y + cellLayout.corridor.h / 2,
      }),
      Interactable({ kind: 'wash', label: '洗手台' }),
      TemplateRef({ id: 'corridor-washstand' }),
    )
  }
}

// ── CRAFTED LAYOUT ───────────────────────────────────────────────────────────

function spawnCrafted(layout: CraftedLayout, slot: PlacedSlot, _rng: SeededRng): void {
  const { rect } = slot

  for (const wall of layout.internalWalls ?? []) {
    spawnWallEntity({
      x: rect.x + wall.relPixel.x,
      y: rect.y + wall.relPixel.y,
      w: wall.sizePx.w,
      h: wall.sizePx.h,
    })
  }

  for (const gate of layout.factionGates ?? []) {
    const gx = rect.x + gate.relPixel.x
    const gy = rect.y + gate.relPixel.y
    spawnDoorEntity({
      x: gx, y: gy, w: gate.sizePx.w, h: gate.sizePx.h,
      orient: gate.orient,
      factionGate: gate.faction as FactionId,
    })
  }

  const counters: Record<string, number> = {}
  for (const item of layout.items) {
    spawnCraftedItem(item, rect, counters)
  }
}

function spawnCraftedItem(
  item: CraftedItem,
  rect: { x: number; y: number; w: number; h: number },
  counters: Record<string, number>,
): void {
  if (isWorkstationGrid(item)) {
    let idx = 0
    for (let r = 0; r < item.rows; r++) {
      for (let c = 0; c < item.cols; c++) {
        const templateId = item.templates[idx]
        const template = getObjectTemplate(templateId)
        if (template.kind !== 'workstation') {
          throw new Error(`workstation_grid template "${templateId}" is not a workstation`)
        }
        const px = rect.x + (item.relTile.x + c * item.colStride) * TILE
        const py = rect.y + (item.relTile.y + r * item.rowStride) * TILE
        const kind: InteractableKind = template.interactableKind ?? 'work'
        world.spawn(
          Position({ x: px, y: py }),
          Interactable({ kind, label: `工位 ${idx + 1}` }),
          Workstation({ specId: template.specId, occupant: null }),
          EntityKey({ key: `ws-ae-floor-${idx}` }),
          TemplateRef({ id: templateId }),
        )
        idx++
      }
    }
    return
  }

  const template = getObjectTemplate(item.template)
  const px = rect.x + item.relTile.x * TILE
  const py = rect.y + item.relTile.y * TILE
  switch (template.kind) {
    case 'workstation':
      spawnWorkstation(item.template, template, { x: px, y: py })
      break
    case 'bed':
      spawnBed(item.template, template, { x: px, y: py }, counters)
      break
    case 'interactable':
      spawnInteractable(item.template, template, { x: px, y: py })
      break
    case 'bar_seat':
      spawnBarSeat(item.template, template, { x: px, y: py }, counters)
      break
    case 'queue_point':
    case 'landmark':
    case 'partition':
      // Not applicable in crafted layout context.
      break
  }
}

// ── AIRPORT + PARK SPAWNERS ─────────────────────────────────────────────────

// Tracks which hubs / terminals / lifts have been bound this bootstrap pass,
// so a runaway district config asking for two airports in one scene doesn't
// silently claim both ends of an inter-city flight pair (and similarly for
// transit terminals — one per scene per placement kind — and orbital lifts —
// one liftId per `orbitalLift` building per scene). Lift keys are
// `${sceneId}::${liftId}` because each lift row spans two scenes and each
// endpoint needs its own kiosk.
const airportHubsBound = new Set<string>()
const transitTerminalsBound = new Set<string>()
const orbitalLiftsBound = new Set<string>()

function spawnAirport(slot: PlacedSlot, sceneId: SceneId): void {
  const { rect, primaryDoor } = slot
  const hub = flightHubs.find((h) => h.sceneId === sceneId && !airportHubsBound.has(h.id))
  if (!hub) return  // No matching/free hub for this scene; ticket counter would be unreachable.
  airportHubsBound.add(hub.id)

  // Counter sits 1.5 tiles in from the wall opposite the primary door,
  // centered on the perpendicular axis. Player walks up to it from inside.
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  let counterX = cx, counterY = cy
  const inset = TILE * 1.5
  if (primaryDoor.side === 'n')      counterY = rect.y + rect.h - inset
  else if (primaryDoor.side === 's') counterY = rect.y + inset
  else if (primaryDoor.side === 'w') counterX = rect.x + rect.w - inset
  else                               counterX = rect.x + inset

  world.spawn(
    Position({ x: counterX, y: counterY }),
    Interactable({ kind: 'ticketCounter', label: '售票处' }),
    FlightHub({ hubId: hub.id }),
    EntityKey({ key: `flighthub-${hub.id}` }),
    TemplateRef({ id: 'airport-ticket-counter' }),
  )

  // Arrival point: 2 tiles outside the door, perpendicular to the wall.
  // Far enough that the player doesn't immediately retrigger the door
  // collision when they fade in.
  const doorOutside = outsideDoorPoint(rect, primaryDoor)
  let arrivalX = doorOutside.x, arrivalY = doorOutside.y
  if (primaryDoor.side === 'n')      arrivalY -= TILE
  else if (primaryDoor.side === 's') arrivalY += TILE
  else if (primaryDoor.side === 'w') arrivalX -= TILE
  else                               arrivalX += TILE

  setAirportPlacement(hub.id, {
    counterPx: { x: counterX, y: counterY },
    arrivalPx: { x: arrivalX, y: arrivalY },
    rectTile: {
      x: rect.x / TILE,
      y: rect.y / TILE,
      w: rect.w / TILE,
      h: rect.h / TILE,
    },
  })

  // Embedded transit kiosk: this scene's `placement: 'airport'` terminal.
  // Sits 1.5 tiles in from the door wall, offset 2-3 tiles laterally from
  // the door so it doesn't block the entrance. Bus arrivals teleport the
  // player to a tile next to the kiosk (still inside the airport lobby).
  spawnAirportTransit(rect, primaryDoor, sceneId)

  // Boarding kiosk one tile away from the counter, perpendicular to the
  // door axis. Slice H gates the actual board on the player's shipOwned
  // flag at click time.
  if (hub.sceneId === 'vonBraunCity') {
    let boardX = counterX, boardY = counterY
    if (primaryDoor.side === 'n' || primaryDoor.side === 's') boardX = counterX + TILE
    else                                                       boardY = counterY + TILE
    world.spawn(
      Position({ x: boardX, y: boardY }),
      Interactable({ kind: 'boardShip', label: '登船', fee: 0 }),
      EntityKey({ key: `boardship-${hub.id}` }),
      TemplateRef({ id: 'ship-board' }),
    )

    // Phase 6.2.C1 — AE ship sales desk. Sits inside the VB airport's
    // lobby at the special-NPC's authored tile so the spawn loop can
    // pre-assign it via workstation:'ae_ship_sales_vb'. Desk is scenery
    // (noInteractable) — the talk-verb on the seated NPC drives the
    // aeShipSales branch. Tile coords come from fleet.json5; the rep's
    // special-NPC entry must mirror them.
    const deskTile = fleetConfig.shipSalesDeskTileVB
    world.spawn(
      Position({ x: TILE * deskTile.x, y: TILE * deskTile.y }),
      Workstation({ specId: 'ae_ship_sales_vb', occupant: null, managerStation: null }),
      EntityKey({ key: 'ws-ae_ship_sales_vb' }),
    )
  }
}

function pickTransitTerminal(sceneId: SceneId, placement: TransitPlacementKind): TransitTerminal | null {
  for (const t of transitTerminals) {
    if (t.sceneId !== sceneId) continue
    if (t.placement !== placement) continue
    if (transitTerminalsBound.has(t.id)) continue
    return t
  }
  return null
}

function spawnTransitEntity(term: TransitTerminal, terminalPx: { x: number; y: number }, arrivalPx: { x: number; y: number }): void {
  transitTerminalsBound.add(term.id)
  world.spawn(
    Position({ x: terminalPx.x, y: terminalPx.y }),
    Interactable({ kind: 'transit', label: term.shortZh }),
    Transit({ terminalId: term.id }),
    EntityKey({ key: `transit-${term.id}` }),
    TemplateRef({ id: 'transit-kiosk' }),
  )
  setTransitPlacement(term.id, { terminalPx, arrivalPx })
}

function spawnAirportTransit(
  rect: { x: number; y: number; w: number; h: number },
  primaryDoor: DoorPlacement,
  sceneId: SceneId,
): void {
  const term = pickTransitTerminal(sceneId, 'airport')
  if (!term) return  // No airport-bound terminal declared for this scene.

  const inset = TILE * 1.5
  // Lateral offset from the door axis — clamp to keep the kiosk fully
  // inside the building (1.5 tiles from each side wall).
  const lateralOffset = TILE * 3
  let kx: number, ky: number
  if (primaryDoor.side === 'n' || primaryDoor.side === 's') {
    const minX = rect.x + inset
    const maxX = rect.x + rect.w - inset
    kx = clamp(rect.x + primaryDoor.offsetPx + lateralOffset, minX, maxX)
    ky = primaryDoor.side === 'n' ? rect.y + inset : rect.y + rect.h - inset
  } else {
    const minY = rect.y + inset
    const maxY = rect.y + rect.h - inset
    ky = clamp(rect.y + primaryDoor.offsetPx + lateralOffset, minY, maxY)
    kx = primaryDoor.side === 'w' ? rect.x + inset : rect.x + rect.w - inset
  }

  // Arrival sits at the door axis, one tile inside — keeps the player
  // off the kiosk sprite so the click doesn't re-trigger.
  let ax: number, ay: number
  if (primaryDoor.side === 'n' || primaryDoor.side === 's') {
    ax = rect.x + primaryDoor.offsetPx + primaryDoor.widthPx / 2
    ay = primaryDoor.side === 'n' ? rect.y + inset : rect.y + rect.h - inset
  } else {
    ay = rect.y + primaryDoor.offsetPx + primaryDoor.widthPx / 2
    ax = primaryDoor.side === 'w' ? rect.x + inset : rect.x + rect.w - inset
  }

  spawnTransitEntity(term, { x: kx, y: ky }, { x: ax, y: ay })
}

function spawnTransitBuilding(slot: PlacedSlot, sceneId: SceneId): void {
  const { rect, primaryDoor } = slot
  const term = pickTransitTerminal(sceneId, 'building')
  if (!term) return  // No building-placement terminal declared for this scene.

  // Kiosk centered against the wall opposite the primary door — same
  // geometry as the airport's ticket counter.
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  let kx = cx, ky = cy
  const inset = TILE * 1.5
  if (primaryDoor.side === 'n')      ky = rect.y + rect.h - inset
  else if (primaryDoor.side === 's') ky = rect.y + inset
  else if (primaryDoor.side === 'w') kx = rect.x + rect.w - inset
  else                               kx = rect.x + inset

  // Arrival just outside the door — clean walkable street tile, no
  // re-trigger risk and no door-collision flicker.
  const doorOutside = outsideDoorPoint(rect, primaryDoor)

  spawnTransitEntity(term, { x: kx, y: ky }, doorOutside)
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : (v > hi ? hi : v)
}

// ── ORBITAL LIFT VESTIBULE ───────────────────────────────────────────────────

function spawnLiftBuilding(slot: PlacedSlot, sceneId: SceneId): void {
  const { rect, primaryDoor } = slot
  const lift = liftsForScene(sceneId).find((l) => !orbitalLiftsBound.has(`${sceneId}::${l.id}`))
  if (!lift) return  // No matching/free lift for this scene; vestibule is inert.
  orbitalLiftsBound.add(`${sceneId}::${lift.id}`)

  // Kiosk centered against the wall opposite the primary door — same
  // geometry as the airport's ticket counter and the transit kiosk.
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  let kx = cx, ky = cy
  const inset = TILE * 1.5
  if (primaryDoor.side === 'n')      ky = rect.y + rect.h - inset
  else if (primaryDoor.side === 's') ky = rect.y + inset
  else if (primaryDoor.side === 'w') kx = rect.x + rect.w - inset
  else                               kx = rect.x + inset

  world.spawn(
    Position({ x: kx, y: ky }),
    Interactable({ kind: 'orbitalLift', label: lift.shortZh, fee: liftFareFrom(lift, sceneId) ?? 0 }),
    OrbitalLift({ liftId: lift.id }),
    EntityKey({ key: `orbital-lift-${lift.id}-${sceneId}` }),
    TemplateRef({ id: 'orbital-lift-kiosk' }),
  )
}

function spawnPark(layout: ParkLayout, slot: PlacedSlot, rng: SeededRng): void {
  const { rect } = slot
  const tilesW = Math.max(1, Math.floor(rect.w / TILE) - 1)
  const tilesH = Math.max(1, Math.floor(rect.h / TILE) - 1)

  // Reservation set so two fixtures don't land on the same tile.
  const used = new Set<string>()
  const pickFreeTile = (): { x: number; y: number } | null => {
    for (let attempt = 0; attempt < 16; attempt++) {
      const tx = rng.intRange(0, tilesW)
      const ty = rng.intRange(0, tilesH)
      const key = `${tx},${ty}`
      if (used.has(key)) continue
      used.add(key)
      return { x: rect.x + tx * TILE + TILE / 2, y: rect.y + ty * TILE + TILE / 2 }
    }
    return null
  }

  const tapCount      = rng.intRange(layout.taps.min,     layout.taps.max)
  const scavengeCount = rng.intRange(layout.scavenge.min, layout.scavenge.max)
  const benchCount    = rng.intRange(layout.benches.min,  layout.benches.max)

  for (let i = 0; i < tapCount; i++) {
    const p = pickFreeTile()
    if (!p) break
    world.spawn(
      Position(p),
      Interactable({ kind: 'tap', label: '街边水龙头' }),
      TemplateRef({ id: 'park-tap' }),
    )
    addRoughSource('tap', p)
  }
  for (let i = 0; i < scavengeCount; i++) {
    const p = pickFreeTile()
    if (!p) break
    world.spawn(
      Position(p),
      Interactable({ kind: 'scavenge', label: '垃圾桶' }),
      TemplateRef({ id: 'park-scavenge' }),
    )
    addRoughSource('scavenge', p)
  }
  for (let i = 0; i < benchCount; i++) {
    const p = pickFreeTile()
    if (!p) break
    const idx = roughSpotCounter++
    world.spawn(
      Position(p),
      Interactable({ kind: 'rough', label: '街边长椅' }),
      RoughSpot({ occupant: null }),
      EntityKey({ key: `roughspot-${idx}` }),
      TemplateRef({ id: 'park-bench' }),
    )
    addRoughSource('rough', p)
  }
}

// ── NPC SPAWNING ─────────────────────────────────────────────────────────────

function spawnSpecialNpcs(sceneId: SceneId): void {
  for (const sn of specialNpcs) {
    // Virtual NPCs (notable hostiles, future off-screen characters) omit
    // tile coords — they exist as referenceable rows only, not placed in
    // any city tilemap.
    if (sn.tileX === undefined || sn.tileY === undefined) continue
    // Phase 6.2.C2 — NPCs default to vonBraunCity (initialSceneId) when
    // `sceneId` is omitted, matching every legacy entry. Reps pinned to
    // other scenes (Granada drydock, etc.) declare an explicit sceneId.
    const targetScene = sn.sceneId ?? initialSceneId
    if (targetScene !== sceneId) continue
    const ent = spawnNPC(world, {
      name: sn.name,
      color: sn.color,
      title: sn.title,
      x: TILE * sn.tileX,
      y: TILE * sn.tileY,
      fatigue: sn.fatigue,
      hunger: sn.hunger,
      thirst: sn.thirst,
      money: sn.money,
      skills: sn.skills,
      factionRole: sn.factionRole,
      key: `npc-spec-${sn.name}`,
    })
    if (sn.workstation) {
      for (const wsEnt of world.query(Workstation)) {
        const ws = wsEnt.get(Workstation)!
        if (ws.specId === sn.workstation && ws.occupant === null) {
          wsEnt.set(Workstation, { ...ws, occupant: ent })
          ent.set(Job, { workstation: wsEnt, unemployedSinceMs: 0 })
          break
        }
      }
    }
  }
}

// Phase 6.2.C2 — Granada drydock AE sales desk. Standalone workstation
// (no Building backing) at the configured concourse tile so the rep's
// special-NPC entry can pre-claim the seat via specId match. Mirrors
// the VB desk shape in spawnAirport, but for a scene without an airport.
function spawnGranadaShipSalesDesk(): void {
  const deskTile = fleetConfig.shipSalesDeskTileGranada
  world.spawn(
    Position({ x: TILE * deskTile.x, y: TILE * deskTile.y }),
    Workstation({ specId: 'ae_ship_sales_granada', occupant: null, managerStation: null }),
    EntityKey({ key: 'ws-ae_ship_sales_granada' }),
  )
}

function spawnAeWorkforce(): void {
  const specProfiles: Record<string, {
    mechanics: number; computers: number; money: number; fatigue: number;
  }> = {
    ae_assembler:        { mechanics: 200,  computers: 50,   money: 80,  fatigue: 25 },
    ae_technician:       { mechanics: 1800, computers: 600,  money: 150, fatigue: 22 },
    ae_engineer:         { mechanics: 3800, computers: 1200, money: 400, fatigue: 18 },
    ae_senior_engineer:  { mechanics: 6500, computers: 3500, money: 900, fatigue: 15 },
  }

  let counter = 0
  for (const wsEnt of world.query(Workstation, Position)) {
    const ws = wsEnt.get(Workstation)!
    if (ws.occupant !== null) continue
    const profile = specProfiles[ws.specId]
    if (!profile) continue

    const wp = wsEnt.get(Position)!
    counter += 1
    const ent = spawnNPC(world, {
      name: pickFreshName(world),
      color: pickRandomColor(),
      title: 'AE 员工',
      x: wp.x,
      y: wp.y,
      money: profile.money,
      fatigue: profile.fatigue,
      skills: { mechanics: profile.mechanics, computers: profile.computers },
      factionRole: { faction: 'anaheim', role: 'staff' },
      key: `npc-ae-staff-${counter}`,
    })
    wsEnt.set(Workstation, { ...ws, occupant: ent })
    ent.set(Job, { workstation: wsEnt, unemployedSinceMs: 0 })
  }
}

// Seed a non-initial scene with its replenishment-target headcount at
// bootstrap, so the first time the player visits the scene reads as a
// staffed standing population instead of an empty room slowly trickling
// in immigrants. The population system in src/systems/population.ts then
// maintains the count from there.
function spawnReplenishmentSeed(scene: MicroSceneConfig): void {
  if (!scene.replenishment) return
  const target = scene.replenishment.target
  const tile = scene.replenishment.arrivalTile
  for (let i = 0; i < target; i++) {
    spawnNPC(world, {
      name: pickFreshName(world),
      color: pickRandomColor(),
      title: '市民',
      x: TILE * tile.x,
      y: TILE * tile.y,
      money: 50 + Math.floor(Math.random() * 100),
      key: `npc-seed-${scene.id}-${i + 1}`,
    })
  }
}

function spawnFoundingCivilians(scene: MicroSceneConfig): void {
  // Drop the founders at the player's spawn tile so the city's "first day"
  // crowd reads as arriving together.
  const spawn = scene.playerSpawnTile ?? { x: 0, y: 0 }
  const ARRIVAL_X = TILE * spawn.x
  const ARRIVAL_Y = TILE * spawn.y
  const tiers: Array<{
    count: number
    money: () => number
    fatigue: () => number
    hunger?: () => number
    thirst?: () => number
    skills?: () => NPCSpec['skills']
  }> = [
    { count: 2, money: () => 700 + Math.floor(Math.random() * 100), fatigue: () => 20 + Math.floor(Math.random() * 30), skills: () => ({ mechanics: 1500 + Math.floor(Math.random() * 2000) }) },
    { count: 3, money: () => 200 + Math.floor(Math.random() * 70),  fatigue: () => 10 + Math.floor(Math.random() * 15) },
    { count: 6, money: () => 80 + Math.floor(Math.random() * 70),   fatigue: () => 20 + Math.floor(Math.random() * 20) },
    { count: 3, money: () => 40 + Math.floor(Math.random() * 30),   fatigue: () => 35 + Math.floor(Math.random() * 15) },
    { count: 3, money: () => 5 + Math.floor(Math.random() * 15),    fatigue: () => 50 + Math.floor(Math.random() * 15), hunger: () => 50 + Math.floor(Math.random() * 15), thirst: () => 20 + Math.floor(Math.random() * 30) },
  ]
  let counter = 0
  for (const tier of tiers) {
    for (let i = 0; i < tier.count; i++) {
      counter += 1
      spawnNPC(world, {
        name: pickFreshName(world),
        color: pickRandomColor(),
        title: '市民',
        x: ARRIVAL_X,
        y: ARRIVAL_Y,
        money: tier.money(),
        fatigue: tier.fatigue(),
        hunger: tier.hunger?.(),
        thirst: tier.thirst?.(),
        skills: tier.skills?.(),
        key: `npc-found-${counter}`,
      })
    }
  }
}

// ── SCENE BOOTSTRAP ──────────────────────────────────────────────────────────

let roughSpotCounter = 0

function bootstrapMicroScene(scene: MicroSceneConfig, opts: SetupWorldOpts): void {
  // Faction entities first — Building spawns below resolve their default
  // Owner.entity against this set.
  bootstrapFactions(world)

  if (!opts.skipDefaultPlayer && scene.id === initialSceneId && scene.playerSpawnTile) {
    spawnPlayer(world, {
      x: TILE * scene.playerSpawnTile.x,
      y: TILE * scene.playerSpawnTile.y,
    })
  }

  for (const cfg of scene.procgenZones ?? []) {
    if (!cfg.enabled) continue
    const zoneRng = SeededRng.fromString(cfg.seed)
    const reserved = cfg.resolvedReservedRects ?? []
    const grid = generateRoadGrid(cfg.rect, cfg.roads, zoneRng, reserved)
    for (const seg of grid.segments) {
      world.spawn(Road({ x: seg.rect.x, y: seg.rect.y, w: seg.rect.w, h: seg.rect.h, kind: seg.kind }))
    }
    for (const sb of grid.subBlocks) {
      if (!sb.reservedFor) continue
      const tile = { x: sb.rect.x / TILE, y: sb.rect.y / TILE }
      const resolved = reserved.find((r) => r.typeId === sb.reservedFor && r.rect.x === tile.x && r.rect.y === tile.y)
      const pb = placeFixedBuilding(sb.reservedFor, tile, zoneRng, resolved?.door)
      spawnBuilding(pb.typeId, pb.slot, zoneRng, scene.id)
    }
    for (const pb of assignBuildings(cfg.rect, grid.subBlocks, cfg.districts, zoneRng)) {
      spawnBuilding(pb.typeId, pb.slot, zoneRng, scene.id)
    }
  }

  // Fixed buildings get their own RNG so adding/removing a procgen zone
  // doesn't perturb door offsets on hand-placed buildings.
  const fixedRng = SeededRng.fromString(`${scene.id}:fixed`)
  for (const fb of scene.fixedBuildings ?? []) {
    const pb = placeFixedBuilding(fb.type, fb.tile, fixedRng, fb.door)
    spawnBuilding(pb.typeId, pb.slot, fixedRng, scene.id)
  }

  // Phase 6.2.C2 — Granada drydock concourse AE sales desk. Spawned in
  // its own scene so the granada-bound rep entry in special-npcs.json5
  // can pre-claim the seat. Other scenes get nothing.
  if (scene.id === 'granadaDrydock') {
    spawnGranadaShipSalesDesk()
  }

  // Per-scene specials. AE board / managers / reception and the AE
  // workforce only make sense in vonBraunCity (aeComplex host). The
  // Granada rep is filtered in by sceneId on its row. Founding civilians
  // spawn in the initial scene only; other scenes with replenishment seed
  // up to target so their first visit reads as staffed rather than empty.
  spawnSpecialNpcs(scene.id)
  if (scene.id === initialSceneId) {
    spawnAeWorkforce()
    spawnFoundingCivilians(scene)
  } else {
    spawnReplenishmentSeed(scene)
  }

  // Now that the candidate NPC pool exists, re-stamp every 'private' building
  // with a named owner so the realtor has private-inventory listings from
  // day one. Civic and faction-owned buildings stay untouched.
  seedPrivateOwners(world, scene.id)
}

// Ship interior bootstrap. Spawns the walkable flagship: Ship instance
// (Starsector stat block) tagged with IsFlagshipMark so flagship helpers
// can find it, one ShipRoom per blueprint room (pure walkable space — the
// FTL room/system/oxygen/fire model goes away), one WeaponMount per
// hardpoint, and the starmap + disembark kiosks at the bridge / hangar.
function bootstrapShipScene(scene: ShipSceneConfig): void {
  const cls = getShipClass(scene.shipClassId)

  // Player starts docked at Von Braun by default. Derived world position
  // from orbital parameters lands in slice 3 — for now fleetPos is a
  // placeholder; the docked-POI id is the source of truth.
  const fleetPos = { x: 0, y: 0 }

  const flagship = world.spawn(
    Ship({
      templateId: cls.id,
      name: defaultShipName(cls),
      hullCurrent: cls.hullMax, hullMax: cls.hullMax,
      armorCurrent: cls.armorMax, armorMax: cls.armorMax,
      fluxMax: cls.fluxMax, fluxCurrent: 0,
      fluxDissipation: cls.fluxDissipation,
      hasShield: cls.hasShield,
      shieldEfficiency: cls.shieldEfficiency,
      topSpeed: cls.topSpeed,
      accel: cls.accel,
      decel: cls.decel,
      angularAccel: cls.angularAccel,
      maxAngVel: cls.maxAngVel,
      crCurrent: cls.crMax, crMax: cls.crMax,
      fuelCurrent: cls.fuelMax, fuelMax: cls.fuelMax,
      suppliesCurrent: cls.suppliesMax, suppliesMax: cls.suppliesMax,
      dockedAtPoiId: 'vonBraun',
      fleetPos,
      inCombat: false,
      // Phase 6.2.E1 — flagship anchors at the center slot of the
      // war-room formation grid and starts with the default aggression.
      aggression: fleetConfig.aggressionDefault,
      formationSlot: fleetConfig.activeFleetGrid.flagshipSlot,
    }),
    IsFlagshipMark(),
    // Phase 6.2.E1 — the flagship is always in the active fleet (the
    // ship the player is on can't be in reserve). The war-room UI
    // enforces the constraint; the marker is the source of truth.
    IsInActiveFleet(),
    EntityKey({ key: 'ship' }),
    Owner({ kind: 'character', entity: null }),
  )
  // Phase 6.2.B — project the class scalars into the per-ship StatSheet
  // and seed an empty ShipEffectsList. Save round-trip rebuilds the
  // sheet's modifier arrays from the list at load (see boot/saveHandlers/
  // shipEffects.ts).
  attachShipStatSheet(flagship)

  seedShipSceneLayout(cls, getWorld(SHIP_SCENE_ID))
}

const SHIP_SCENE_ID: SceneId = 'playerShipInterior'

// Class-specific layout for the ship-interior scene: rooms, walls/doors,
// weapon mounts, and per-room kiosks. Idempotent only on a torn-down
// world — call `tearDownShipSceneLayout` first if the scene already
// carries another class's layout.
//
// Used at boot by `bootstrapShipScene` and at runtime by the flagship-
// switch flow in `src/sim/scene.ts` (boarding a different player-owned
// ship swaps the interior to that ship's class).
export function seedShipSceneLayout(cls: ShipClassDef, targetWorld: World): void {
  for (const room of cls.rooms) {
    const px = room.bounds.x * TILE
    const py = room.bounds.y * TILE
    const pw = room.bounds.w * TILE
    const ph = room.bounds.h * TILE
    targetWorld.spawn(
      Position({ x: px + pw / 2, y: py + ph / 2 }),
      Building({ x: px, y: py, w: pw, h: ph, label: room.nameZh }),
      ShipRoom({ roomDefId: room.id }),
      EntityKey({ key: `ship-room-${room.id}` }),
      TemplateRef({ id: 'building-outline' }),
    )
  }

  layoutShipInterior(cls, targetWorld)
  markPathfindingDirty(SHIP_SCENE_ID)

  for (const m of cls.mounts) {
    const wid = cls.defaultWeapons[m.idx] ?? ''
    // Default targetIdx is 0 (first hostile in the EnemyShipState array);
    // tactical UI lets the player retarget.
    targetWorld.spawn(
      WeaponMount({
        mountIdx: m.idx,
        weaponId: wid,
        size: m.size,
        firingArcRad: (m.firingArcDeg * Math.PI) / 180,
        facingRad: (m.facingDeg * Math.PI) / 180,
        chargeSec: 0,
        ready: false,
        targetIdx: 0,
      }),
      EntityKey({ key: `ship-weapon-${m.idx}` }),
    )
  }
  // Reference getWeapon so unused-import lint stays quiet — also serves
  // as a lightweight defaultWeapons existence check at boot time.
  for (const wid of cls.defaultWeapons) if (wid) getWeapon(wid)

  for (const room of cls.rooms) {
    if (!room.interactables) continue
    const cx = (room.bounds.x + room.bounds.w / 2) * TILE
    const cy = (room.bounds.y + room.bounds.h / 2) * TILE
    room.interactables.forEach((k, i) => {
      const dx = (k.offset?.dx ?? 0) * TILE
      const dy = (k.offset?.dy ?? 0) * TILE
      const templateId = shipKioskTemplateFor(k.kind)
      targetWorld.spawn(
        Position({ x: cx + dx, y: cy + dy }),
        Interactable({ kind: k.kind, label: k.label, fee: 0 }),
        EntityKey({ key: `ship-kiosk-${room.id}-${i}` }),
        TemplateRef({ id: templateId }),
      )
    })
  }
}

// Inverse of `seedShipSceneLayout` — destroys every class-specific entity
// in the ship-interior scene (rooms, walls, doors, weapon mounts, and
// kiosks) while leaving per-ship instance state (Ship, ShipStatSheet,
// ShipEffectsList, EntityKey, Owner, IsFlagshipMark) untouched. Used by
// the flagship-switch flow before seeding a new class's layout.
export function tearDownShipSceneLayout(targetWorld: World): void {
  const doomed: Entity[] = []
  for (const ent of targetWorld.query(ShipRoom)) doomed.push(ent)
  for (const ent of targetWorld.query(Wall)) doomed.push(ent)
  for (const ent of targetWorld.query(Door)) doomed.push(ent)
  for (const ent of targetWorld.query(WeaponMount)) doomed.push(ent)
  for (const ent of targetWorld.query(Interactable, EntityKey)) {
    const k = ent.get(EntityKey)!.key
    if (k.startsWith('ship-kiosk-')) doomed.push(ent)
  }
  for (const ent of doomed) ent.destroy()
}

// Ship-room interactable kinds and their authored object-templates.
// Kept colocated with the spawn site so adding a new ship kiosk kind
// fails loudly at boot if the template hasn't been authored yet.
const SHIP_KIOSK_TEMPLATES: Record<string, ObjectTemplateId> = {
  helm:           'ship-helm',
  captainsDesk:   'ship-captains-desk',
  commPanel:      'ship-comm-panel',
  warRoom:        'ship-war-room',
  disembarkShip:  'ship-disembark',
  climbIntoMs:    'ship-climb-into-ms',
  brig:           'ship-brig',
}

function shipKioskTemplateFor(kind: string): ObjectTemplateId {
  const id = SHIP_KIOSK_TEMPLATES[kind]
  if (!id) throw new Error(`ship-kiosk kind "${kind}" has no template binding in spawn.ts`)
  return id
}

function runSceneBootstrap(scene: SceneConfig, opts: SetupWorldOpts): void {
  switch (scene.sceneType) {
    case 'micro': bootstrapMicroScene(scene, opts); break
    case 'ship':  bootstrapShipScene(scene);  break
  }
}

// ── HELPERS ──────────────────────────────────────────────────────────────────

type BedTier = 'flop' | 'dorm' | 'apartment' | 'luxury' | 'lounge'

function bedRent(tier: BedTier): number {
  if (tier === 'lounge') return 0
  const key = `${tier}Bed` as keyof typeof economyConfig.prices
  return economyConfig.prices[key] as number
}

function bedLabel(tier: BedTier): string {
  switch (tier) {
    case 'flop':      return '投币床'
    case 'dorm':      return '宿舍床'
    case 'apartment': return '床'
    case 'luxury':    return '高级床'
    case 'lounge':    return '员工沙发'
  }
}

// ── PUBLIC API ───────────────────────────────────────────────────────────────

let initialized = false

export interface SetupWorldOpts {
  skipDefaultPlayer: boolean
}

export function setupWorld(opts: SetupWorldOpts = { skipDefaultPlayer: false }) {
  if (initialized) return
  initialized = true

  roughSpotCounter = 0
  airportHubsBound.clear()
  transitTerminalsBound.clear()
  orbitalLiftsBound.clear()
  for (const k of Object.keys(buildingKeyCounters)) delete buildingKeyCounters[k]
  clearAirportPlacements()
  clearTransitPlacements()

  // Allocate the per-world singleton on every scene world up-front. Per-
  // world resource traits attach lazily on first read; the singleton itself
  // exists from boot so save handlers, tests, and reset paths can rely on
  // it being available without further bootstrap calls.
  for (const id of SCENE_IDS) bootstrapWorldSingleton(getWorld(id))

  for (const scene of scenes) {
    if (scene.sceneType === 'space') {
      bootstrapSpaceCampaign()
      continue
    }
    setActiveSceneId(scene.id)
    runSceneBootstrap(scene, opts)
    markPathfindingDirty()
  }

  setActiveSceneId(initialSceneId)
}

// World-reset fans out to every registered SaveHandler via the
// registry; subsystems own their own reset(). Adding a tenth
// reset-needing subsystem == one new file under boot/saveHandlers/.
export function resetWorld() {
  for (const id of SCENE_IDS) getWorld(id).reset()
  clearLandmarks()
  resetAll()
  initialized = false
  setupWorld()
}

export function __resetSetupWorldForTests(): void {
  initialized = false
}
