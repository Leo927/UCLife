import { world, setActiveSceneId, getWorld, SCENE_IDS, type SceneId } from './world'
import { scenes, initialSceneId, type SceneConfig } from '../data/scenes'
import {
  Position, MoveTarget, Vitals, Health, Action, Interactable, IsPlayer,
  Money, Skills, Inventory, Building, Job, Character, Workstation,
  JobPerformance, Bed, Wall, Door, Attributes, BarSeat, RoughSpot,
  EntityKey, Reputation, JobTenure, FactionRole, Appearance, Transit,
  FlightHub, Road, Ambitions, Flags,
  type Gender, type InteractableKind,
} from './traits'
import { transitTerminals } from '../data/transit'
import { flightHubs } from '../data/flights'
import { setAirportPlacement, clearAirportPlacements } from '../sim/airportPlacements'
import { getAppearanceOverride } from '../data/appearance'
import { generateAppearanceForName } from '../data/appearanceGen'
import { specialNpcs } from '../data/specialNpcs'
import { pickFreshName, pickRandomColor } from '../data/nameGen'
import type { FactionId } from '../data/factions'
import { markPathfindingDirty } from '../systems/pathfinding'
import { worldConfig, economyConfig } from '../config'
import {
  SeededRng, generateCells, maxHorizontalCells, maxVerticalCells,
  generateRoadGrid, assignBuildings,
} from '../procgen'
import { placeFixedBuilding } from '../procgen/slots'
import type { DoorPlacement, DoorSide, PlacedSlot } from '../procgen/slots'
import { layoutOpenFloorItems } from '../procgen/itemLayout'
import {
  getBuildingType,
  type CraftedItem, type ProcgenItem, type OpenFloorLayout,
  type CellsLayout, type CraftedLayout, type ParkLayout,
  type ProcgenWorkstationItem,
} from '../data/buildingTypes'
import { setLandmark, clearLandmarks, addRoughSource, setShopRect } from '../data/landmarks'
import { resetPopulationClock } from '../systems/population'
import { resetRelationsClock } from '../systems/relations'
import { resetPromotionNotices } from '../systems/promotion'
import { resetNpcBuckets } from '../systems/npc'
import { resetActiveZone } from '../systems/activeZone'
import { resetVitalsAccum } from '../systems/vitals'
import { resetStressAccum } from '../systems/stress'

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

function spawnBuilding(typeId: string, slot: PlacedSlot, rng: SeededRng, sceneId: SceneId): void {
  const btype = getBuildingType(typeId)
  world.spawn(Building({ ...slot.rect, label: btype.labelZh }))

  const layout = btype.layout
  // Park has no exterior walls and no doors — skip enclose entirely.
  if (layout.algorithm !== 'park') {
    enclose(slot.rect, [slot.primaryDoor, ...slot.extraDoors])
  }

  switch (layout.algorithm) {
    case 'open_floor':  spawnOpenFloor(layout, slot); break
    case 'cells':       spawnCells(typeId, layout, slot, rng); break
    case 'airport':     spawnAirport(slot, sceneId); break
    case 'park':        spawnPark(layout, slot, rng); break
    case 'crafted':     spawnCrafted(layout, slot, rng); break
  }
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

  for (const pi of placedItems) {
    if (pi.item.type === 'workstation') {
      const role = (pi.item as ProcgenWorkstationItem).role
      if ((role === 'supervisor' || role === 'counter') && counterPos === undefined) {
        counterPos = { x: pi.x, y: pi.y }
      }
    }
    spawnProcgenItem(pi, counters)
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
): void {
  const { x, y, item, specId } = pi

  switch (item.type) {
    case 'workstation': {
      const sid = specId
      if (!sid) break
      const wsItem = item as ProcgenWorkstationItem
      const idx = counters[sid] ?? 0
      counters[sid] = idx + 1
      if (wsItem.noInteractable) {
        world.spawn(
          Position({ x, y }),
          Workstation({ specId: sid, occupant: null }),
          EntityKey({ key: `ws-${sid}` }),
        )
      } else {
        world.spawn(
          Position({ x, y }),
          Interactable({ kind: (wsItem.kind ?? 'work') as InteractableKind, label: wsItem.labelZh ?? '工位' }),
          Workstation({ specId: sid, occupant: null }),
          EntityKey({ key: `ws-${sid}` }),
        )
      }
      break
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
      break
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
      break
    }

    case 'queue_point': {
      setLandmark('barQueue', { x, y })
      break
    }

    case 'landmark':
    case 'partition':
      break  // handled separately in spawnOpenFloor
  }
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

// Tracks which hubs have been bound this bootstrap pass, so a runaway
// district config asking for two airports in one scene doesn't silently
// claim both ends of an inter-city flight pair.
const airportHubsBound = new Set<string>()

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

// ── TRANSIT ──────────────────────────────────────────────────────────────────

function spawnTransitForScene(sceneId: string): void {
  for (const t of transitTerminals) {
    if (t.sceneId !== sceneId) continue
    world.spawn(
      Position({ x: t.terminalTile.x * TILE, y: t.terminalTile.y * TILE }),
      Interactable({ kind: 'transit', label: t.shortZh }),
      Transit({ terminalId: t.id }),
      EntityKey({ key: `transit-${t.id}` }),
    )
  }
}

// ── NPC SPAWNING ─────────────────────────────────────────────────────────────

function spawnSpecialNpcs(): void {
  for (const sn of specialNpcs) {
    const ent = spawnNPC({
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
    const ent = spawnNPC({
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

function spawnFoundingCivilians(scene: SceneConfig): void {
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
      spawnNPC({
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

function bootstrapMicroScene(scene: SceneConfig): void {
  const rng = SeededRng.fromString(scene.procgen?.seed ?? 'default')

  if (scene.id === initialSceneId && scene.playerSpawnTile) {
    const px = TILE * scene.playerSpawnTile.x
    const py = TILE * scene.playerSpawnTile.y
    const playerEnt = world.spawn(
      IsPlayer,
      Character({ name: '新人', color: '#4ade80', title: '市民' }),
      Position({ x: px, y: py }),
      MoveTarget({ x: px, y: py }),
      Vitals,
      Health,
      Action,
      Money({ amount: 30 }),
      Skills,
      Inventory({ water: 1, meal: 1, books: 0 }),
      Job,
      JobPerformance,
      Attributes,
      Reputation,
      JobTenure,
      Ambitions,
      Flags,
      EntityKey({ key: 'player' }),
    )
    setupAppearance(playerEnt, '新人')
  }

  if (scene.procgen?.enabled) {
    const cfg = scene.procgen
    const grid = generateRoadGrid(cfg.rect, cfg.roads, rng)
    for (const seg of grid.segments) {
      world.spawn(Road({ x: seg.rect.x, y: seg.rect.y, w: seg.rect.w, h: seg.rect.h, kind: seg.kind }))
    }
    for (const pb of assignBuildings(cfg.rect, grid.subBlocks, cfg.districts, rng)) {
      spawnBuilding(pb.typeId, pb.slot, rng, scene.id)
    }
  }

  for (const fb of scene.fixedBuildings ?? []) {
    const pb = placeFixedBuilding(fb.type, fb.tile, rng)
    spawnBuilding(pb.typeId, pb.slot, rng, scene.id)
  }

  spawnTransitForScene(scene.id)

  // Special NPCs (AE board/managers/reception) and the AE workforce only
  // make sense in the scene that hosts aeComplex. Founding civilians spawn
  // wherever the player starts.
  if (scene.id === initialSceneId) {
    spawnSpecialNpcs()
    spawnAeWorkforce()
    spawnFoundingCivilians(scene)
  }
}

function runSceneBootstrap(scene: SceneConfig): void {
  switch (scene.sceneType) {
    case 'micro': bootstrapMicroScene(scene); break
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

import type { Entity } from 'koota'
function setupAppearance(ent: Entity, name: string, gender?: Gender): void {
  const override = getAppearanceOverride(name)
  const genderForGen = gender ?? (override?.gender as Gender | undefined)
  const base = generateAppearanceForName(name, { gender: genderForGen })
  ent.add(Appearance({ ...base, ...override }))
}

// ── PUBLIC API ───────────────────────────────────────────────────────────────

let initialized = false

export function setupWorld() {
  if (initialized) return
  initialized = true

  roughSpotCounter = 0
  airportHubsBound.clear()
  clearAirportPlacements()

  for (const scene of scenes) {
    setActiveSceneId(scene.id)
    runSceneBootstrap(scene)
    markPathfindingDirty()
  }

  setActiveSceneId(initialSceneId)
}

export type NPCSpec = {
  name: string
  color: string
  title?: string
  x: number
  y: number
  fatigue?: number
  hunger?: number
  thirst?: number
  money?: number
  skills?: Partial<Record<'mechanics' | 'marksmanship' | 'athletics' | 'cooking' | 'medicine' | 'computers' | 'piloting' | 'bartending' | 'engineering', number>>
  key?: string
  factionRole?: { faction: FactionId; role: 'staff' | 'manager' | 'board' }
  gender?: Gender
}

export function spawnNPC(spec: NPCSpec) {
  const baseSkills = { mechanics: 0, marksmanship: 0, athletics: 0, cooking: 0, medicine: 0, computers: 0, piloting: 0, bartending: 0, engineering: 0 }
  const fr = spec.factionRole ?? { faction: 'civilian' as FactionId, role: 'staff' as const }
  const ent = world.spawn(
    Character({ name: spec.name, color: spec.color, title: spec.title ?? '市民' }),
    Position({ x: spec.x, y: spec.y }),
    MoveTarget({ x: spec.x, y: spec.y }),
    Action,
    Vitals({
      hunger: spec.hunger ?? 0,
      thirst: spec.thirst ?? 0,
      fatigue: spec.fatigue ?? 0,
      hygiene: 0,
    }),
    Health,
    Money({ amount: spec.money ?? 50 }),
    Skills({ ...baseSkills, ...spec.skills }),
    Inventory({ water: 2, meal: 2, books: 0 }),
    Job,
    JobPerformance,
    Attributes,
    FactionRole({ faction: fr.faction, role: fr.role }),
    EntityKey({ key: spec.key ?? `npc-anon-${Math.random().toString(36).slice(2, 8)}` }),
  )
  setupAppearance(ent, spec.name, spec.gender)
  return ent
}

export function resetWorld() {
  for (const id of SCENE_IDS) getWorld(id).reset()
  clearLandmarks()
  resetPopulationClock()
  resetRelationsClock()
  resetPromotionNotices()
  resetNpcBuckets()
  resetActiveZone()
  resetVitalsAccum()
  resetStressAccum()
  initialized = false
  setupWorld()
}
