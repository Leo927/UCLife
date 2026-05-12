import type { Entity } from 'koota'
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
  Ship, ShipRoom, WeaponMount, IsFlagshipMark,
  Hangar, OrbitalLift,
  type InteractableKind,
} from './traits'
import { getHangarFacilityType } from '../data/facilityTypes'
import { getOrbitalLift } from '../data/orbitalLifts'
import { bootstrapFactions, defaultOwnerFor, seedPrivateOwners } from './ownership'
import { spawnNPC, spawnPlayer, type NPCSpec } from '../character/spawn'
import { getShipClass } from '../data/ship-classes'
import { getWeapon } from '../data/weapons'
import { transitTerminals } from '../data/transit'
import { flightHubs } from '../data/flights'
import { setAirportPlacement, clearAirportPlacements } from '../sim/airportPlacements'
import { setTransitPlacement, clearTransitPlacements } from '../sim/transitPlacements'
import { bootstrapSpaceCampaign } from '../sim/spaceBootstrap'
import { attachShipStatSheet } from './shipEffects'
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
import { layoutOpenFloorItems } from '../procgen/itemLayout'
import { layoutShipInterior } from '../procgen/ship'
import {
  getBuildingType,
  type CraftedItem, type ProcgenItem, type OpenFloorLayout,
  type CellsLayout, type CraftedLayout, type ParkLayout,
  type ProcgenWorkstationItem,
} from '../data/buildingTypes'
import type { TransitTerminal, TransitPlacementKind } from '../data/transit'
import { setLandmark, clearLandmarks, addRoughSource, setShopRect } from '../data/landmarks'
import { resetAll } from '../save/registry'
import { bootstrapWorldSingleton } from './resources'

const TILE = worldConfig.tilePx
const WALL_T = worldConfig.wallThicknessPx

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
    world.spawn(
      Position({ x: dx + dwPx / 2, y: dy + dhPx / 2 }),
      Door({ x: dx, y: dy, w: dwPx, h: dhPx, orient }),
    )
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
      world.spawn(Wall({ x: wx, y: wy, w: ww, h: wh }))
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
    )
  }

  // Phase 6.2.A — hangar facility-class augmentation. Attaches the
  // tier + slotCapacity from facility-types.json5 onto the building
  // entity so the manager's talk-verb can read capacity counts off a
  // single trait without re-deriving from typeId.
  const hangarFacility = getHangarFacilityType(typeId)
  if (hangarFacility) {
    buildingEnt.add(Hangar({
      tier: hangarFacility.tier,
      slotCapacity: hangarFacility.slotCapacity,
      repairPriorityShipKey: '',
      pendingDeliveries: [],
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
  const partItem = layout.items.find((i) => i.type === 'partition')
  if (partItem?.type === 'partition') {
    partitionY = rect.y + partItem.rowFromTop * TILE
    const doorOffsetPx = partItem.doorTiedToPrimary
      ? primaryDoor.offsetPx
      : Math.floor(rect.w / TILE / 2) * TILE
    world.spawn(Wall({ x: rect.x, y: partitionY, w: doorOffsetPx, h: WALL_T }))
    world.spawn(Wall({
      x: rect.x + doorOffsetPx + TILE,
      y: partitionY,
      w: rect.w - doorOffsetPx - TILE,
      h: WALL_T,
    }))
    world.spawn(
      Position({ x: rect.x + doorOffsetPx + TILE / 2, y: partitionY + WALL_T / 2 }),
      Door({ x: rect.x + doorOffsetPx, y: partitionY, w: TILE, h: WALL_T, orient: 'h' }),
    )
  }

  const placedItems = layoutOpenFloorItems(rect, primaryDoor, layout.items, partitionY)
  const counters: Record<string, number> = {}
  let counterPos: { x: number; y: number } | undefined

  // Workers in a building with a recruiting-manager supervisor (today
  // only `factory_manager`) get their hires routed through that
  // manager's desk via the FactoryManagerConversation talk-verb. Collect
  // refs in pass 1, link in pass 2. specId-keyed because the workstation
  // entity itself carries no Interactable kind anymore — it's scenery.
  let managerStation: Entity | null = null
  const workerStations: Entity[] = []

  for (const pi of placedItems) {
    if (pi.item.type === 'workstation') {
      const role = (pi.item as ProcgenWorkstationItem).role
      if ((role === 'supervisor' || role === 'counter') && counterPos === undefined) {
        counterPos = { x: pi.x, y: pi.y }
      }
    }
    const ent = spawnProcgenItem(pi, counters)
    if (ent && pi.item.type === 'workstation') {
      const wsItem = pi.item as ProcgenWorkstationItem
      if (wsItem.role === 'supervisor' && wsItem.specId === 'factory_manager') {
        managerStation = ent
      } else if (wsItem.role === 'worker') {
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
  // After road procgen, the shop's primary door faces the road and its
  // extra door sits on the opposite parallel wall. Customer entry uses the
  // extra door, exit uses the primary.
  const hasShopLandmarks = layout.items.some((i) => i.type === 'landmark')
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
  const hasBarSeats = layout.items.some((i) => i.type === 'bar_seat')
  if (hasBarSeats && counterPos) {
    setLandmark('barCounter', counterPos)
  }
}

function spawnProcgenItem(
  pi: { x: number; y: number; item: ProcgenItem; specId?: string },
  counters: Record<string, number>,
): Entity | null {
  const { x, y, item, specId } = pi

  switch (item.type) {
    case 'workstation': {
      const sid = specId
      if (!sid) return null
      const wsItem = item as ProcgenWorkstationItem
      const idx = counters[sid] ?? 0
      counters[sid] = idx + 1
      const ent = wsItem.noInteractable
        ? world.spawn(
            Position({ x, y }),
            Workstation({ specId: sid, occupant: null }),
            EntityKey({ key: `ws-${sid}` }),
          )
        : world.spawn(
            Position({ x, y }),
            Interactable({ kind: (wsItem.kind ?? 'work') as InteractableKind, label: wsItem.labelZh ?? '工位' }),
            Workstation({ specId: sid, occupant: null }),
            EntityKey({ key: `ws-${sid}` }),
          )
      // Phase 5.5.4 — recruiter desk carries a Recruiter trait (criteria
      // block + per-day counters). Keep the trait attachment co-located
      // with workstation creation so a player who buys the office sees a
      // valid Recruiter trait from day one. Applies regardless of
      // noInteractable: the trait is independent of the cell-verb.
      if (sid === 'recruiter') ent.add(Recruiter)
      return ent
    }

    case 'bar_seat': {
      const idx = counters['bar_seat'] ?? 0
      counters['bar_seat'] = idx + 1
      world.spawn(
        Position({ x, y }),
        Interactable({ kind: 'bar', label: '酒吧座位', fee: 10 }),
        BarSeat({ occupant: null }),
        EntityKey({ key: `barseat-${idx}` }),
      )
      return null
    }

    case 'bed': {
      const tier = item.type === 'bed' ? item.tier : 'flop'
      const rent = bedRent(tier)
      const idx = counters[`bed-${tier}`] ?? 0
      counters[`bed-${tier}`] = idx + 1
      world.spawn(
        Position({ x, y }),
        Interactable({ kind: 'sleep', label: bedLabel(tier), fee: rent }),
        Bed({ tier, nightlyRent: rent, occupant: null, rentPaidUntilMs: 0 }),
        EntityKey({ key: `bed-${tier}-${idx}` }),
      )
      return null
    }

    case 'queue_point': {
      setLandmark('barQueue', { x, y })
      return null
    }

    case 'landmark':
    case 'partition':
      return null  // handled separately in spawnOpenFloor
  }
  return null
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
    if (!item || item.type !== 'bed') return null
    const tier = item.tier
    const rent = bedRent(tier)
    return world.spawn(
      Position({ x: c.bedPos.x, y: c.bedPos.y }),
      Interactable({ kind: 'sleep', label: bedLabel(tier), fee: rent }),
      Bed({ tier, nightlyRent: rent, occupant: null, rentPaidUntilMs: 0 }),
      EntityKey({ key: `bed-${typeId}-${i}` }),
    )
  })

  for (const w of cellLayout.walls) world.spawn(Wall({ ...w }))
  cellLayout.cells.forEach((c, i) => {
    const dr = c.doorRect
    world.spawn(
      Position({ x: dr.x + dr.w / 2, y: dr.y + dr.h / 2 }),
      Door({ ...dr, orient: c.doorOrient, bedEntity: beds[i] ?? undefined }),
    )
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
    )
  }
}

// ── CRAFTED LAYOUT ───────────────────────────────────────────────────────────

function spawnCrafted(layout: CraftedLayout, slot: PlacedSlot, _rng: SeededRng): void {
  const { rect } = slot

  for (const wall of layout.internalWalls ?? []) {
    world.spawn(Wall({
      x: rect.x + wall.relPixel.x,
      y: rect.y + wall.relPixel.y,
      w: wall.sizePx.w,
      h: wall.sizePx.h,
    }))
  }

  for (const gate of layout.factionGates ?? []) {
    const gx = rect.x + gate.relPixel.x
    const gy = rect.y + gate.relPixel.y
    world.spawn(
      Position({ x: gx + gate.sizePx.w / 2, y: gy + gate.sizePx.h / 2 }),
      Door({ x: gx, y: gy, w: gate.sizePx.w, h: gate.sizePx.h, orient: gate.orient, factionGate: gate.faction as FactionId }),
    )
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
  switch (item.type) {
    case 'workstation': {
      const px = rect.x + item.relTile.x * TILE
      const py = rect.y + item.relTile.y * TILE
      // `noInteractable: true` makes the desk pure scenery — used for
      // service-side workstations (cashier, clinic, secretary, etc.)
      // where the verb lives on the worker on duty's body, not the
      // tile. See Design/social/diegetic-management.md.
      if (item.noInteractable) {
        world.spawn(
          Position({ x: px, y: py }),
          Workstation({ specId: item.specId, occupant: null }),
          EntityKey({ key: `ws-${item.specId}` }),
        )
        break
      }
      world.spawn(
        Position({ x: px, y: py }),
        Interactable({ kind: (item.kind ?? 'work') as InteractableKind, label: item.labelZh ?? '工位' }),
        Workstation({ specId: item.specId, occupant: null }),
        EntityKey({ key: `ws-${item.specId}` }),
      )
      break
    }

    case 'workstation_grid': {
      let idx = 0
      for (let r = 0; r < item.rows; r++) {
        for (let c = 0; c < item.cols; c++) {
          const specId = item.specIds[idx]
          const px = rect.x + (item.relTile.x + c * item.colStride) * TILE
          const py = rect.y + (item.relTile.y + r * item.rowStride) * TILE
          world.spawn(
            Position({ x: px, y: py }),
            Interactable({ kind: 'work', label: `工位 ${idx + 1}` }),
            Workstation({ specId, occupant: null }),
            EntityKey({ key: `ws-ae-floor-${idx}` }),
          )
          idx++
        }
      }
      break
    }

    case 'bed': {
      const px = rect.x + item.relTile.x * TILE
      const py = rect.y + item.relTile.y * TILE
      const tier = item.tier
      const rent = bedRent(tier)
      const idx = counters[`bed-${tier}`] ?? 0
      counters[`bed-${tier}`] = idx + 1
      world.spawn(
        Position({ x: px, y: py }),
        Interactable({ kind: 'sleep', label: bedLabel(tier), fee: rent }),
        Bed({ tier, nightlyRent: rent, occupant: null, rentPaidUntilMs: 0 }),
        EntityKey({ key: `bed-${tier}-${idx}` }),
      )
      break
    }

    case 'gym_equipment': {
      const px = rect.x + item.relTile.x * TILE
      const py = rect.y + item.relTile.y * TILE
      world.spawn(
        Position({ x: px, y: py }),
        Interactable({ kind: 'gym', label: item.labelZh }),
      )
      break
    }

    case 'snack_cabinet': {
      const px = rect.x + item.relTile.x * TILE
      const py = rect.y + item.relTile.y * TILE
      world.spawn(
        Position({ x: px, y: py }),
        Interactable({ kind: 'eat', label: '零食柜', fee: 0 }),
      )
      break
    }

    case 'water_dispenser': {
      const px = rect.x + item.relTile.x * TILE
      const py = rect.y + item.relTile.y * TILE
      // No addRoughSource — corporate water is clean (no hygiene penalty).
      world.spawn(
        Position({ x: px, y: py }),
        Interactable({ kind: 'tap', label: '饮水机' }),
      )
      break
    }
  }
}

// ── AIRPORT + PARK SPAWNERS ─────────────────────────────────────────────────

// Tracks which hubs / terminals have been bound this bootstrap pass, so a
// runaway district config asking for two airports in one scene doesn't
// silently claim both ends of an inter-city flight pair (and similarly for
// transit terminals — one per scene per placement kind).
const airportHubsBound = new Set<string>()
const transitTerminalsBound = new Set<string>()

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

// ── FIXED INTERACTABLES ──────────────────────────────────────────────────────

// Standalone kiosk spawn — no Building backing. Centered on the tile;
// resolves any kind-specific extra traits (OrbitalLift today) by inspecting
// the FixedInteractableRef payload.
function spawnFixedInteractable(fi: import('../data/scenes').FixedInteractableRef): void {
  const px = fi.tile.x * TILE + TILE / 2
  const py = fi.tile.y * TILE + TILE / 2
  if (fi.kind === 'orbitalLift') {
    const liftId = fi.liftId
    if (!liftId) throw new Error(`fixedInteractable orbitalLift missing liftId at (${fi.tile.x},${fi.tile.y})`)
    const lift = getOrbitalLift(liftId)
    if (!lift) throw new Error(`fixedInteractable orbitalLift references unknown liftId "${liftId}"`)
    world.spawn(
      Position({ x: px, y: py }),
      Interactable({ kind: 'orbitalLift', label: fi.labelZh ?? lift.shortZh, fee: lift.fare }),
      OrbitalLift({ liftId }),
      EntityKey({ key: `orbital-lift-${liftId}-${fi.tile.x}-${fi.tile.y}` }),
    )
  }
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
    )
    addRoughSource('tap', p)
  }
  for (let i = 0; i < scavengeCount; i++) {
    const p = pickFreeTile()
    if (!p) break
    world.spawn(
      Position(p),
      Interactable({ kind: 'scavenge', label: '垃圾桶' }),
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
    )
    addRoughSource('rough', p)
  }
}

// ── NPC SPAWNING ─────────────────────────────────────────────────────────────

function spawnSpecialNpcs(): void {
  for (const sn of specialNpcs) {
    // Virtual NPCs (notable hostiles, future off-screen characters) omit
    // tile coords — they exist as referenceable rows only, not placed in
    // any city tilemap.
    if (sn.tileX === undefined || sn.tileY === undefined) continue
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

function bootstrapMicroScene(scene: MicroSceneConfig): void {
  // Faction entities first — Building spawns below resolve their default
  // Owner.entity against this set.
  bootstrapFactions(world)

  if (scene.id === initialSceneId && scene.playerSpawnTile) {
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

  // Standalone fixed interactables — hand-placed kiosks that don't belong to
  // any building footprint. Phase 6.2.A.2 ships the first kind: the orbital
  // lift kiosk pairs two scenes; the interaction system reads
  // orbital-lifts.json5 to resolve the destination + fare + duration.
  for (const fi of scene.fixedInteractables ?? []) {
    spawnFixedInteractable(fi)
  }

  // Special NPCs (AE board/managers/reception) and the AE workforce only
  // make sense in the scene that hosts aeComplex. Founding civilians spawn
  // wherever the player starts.
  if (scene.id === initialSceneId) {
    spawnSpecialNpcs()
    spawnAeWorkforce()
    spawnFoundingCivilians(scene)
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
    }),
    IsFlagshipMark(),
    EntityKey({ key: 'ship' }),
  )
  // Phase 6.2.B — project the class scalars into the per-ship StatSheet
  // and seed an empty ShipEffectsList. Save round-trip rebuilds the
  // sheet's modifier arrays from the list at load (see boot/saveHandlers/
  // shipEffects.ts).
  attachShipStatSheet(flagship)

  for (const room of cls.rooms) {
    const px = room.bounds.x * TILE
    const py = room.bounds.y * TILE
    const pw = room.bounds.w * TILE
    const ph = room.bounds.h * TILE
    world.spawn(
      Position({ x: px + pw / 2, y: py + ph / 2 }),
      Building({ x: px, y: py, w: pw, h: ph, label: room.nameZh }),
      ShipRoom({ roomDefId: room.id }),
      EntityKey({ key: `ship-room-${room.id}` }),
    )
  }

  layoutShipInterior(cls)
  markPathfindingDirty()

  for (const m of cls.mounts) {
    const wid = cls.defaultWeapons[m.idx] ?? ''
    // Default targetIdx is 0 (first hostile in the EnemyShipState array);
    // tactical UI lets the player retarget.
    world.spawn(
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
      world.spawn(
        Position({ x: cx + dx, y: cy + dy }),
        Interactable({ kind: k.kind, label: k.label, fee: 0 }),
        EntityKey({ key: `ship-kiosk-${room.id}-${i}` }),
      )
    })
  }
}

function runSceneBootstrap(scene: SceneConfig): void {
  switch (scene.sceneType) {
    case 'micro': bootstrapMicroScene(scene); break
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

export function setupWorld() {
  if (initialized) return
  initialized = true

  roughSpotCounter = 0
  airportHubsBound.clear()
  transitTerminalsBound.clear()
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
    runSceneBootstrap(scene)
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
