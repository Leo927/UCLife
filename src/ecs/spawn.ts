import { world, setActiveSceneId, getWorld, SCENE_IDS, type SceneId } from './world'
import { scenes, initialSceneId, type SceneConfig } from '../data/scenes'
import {
  Position, MoveTarget, Vitals, Health, Action, Interactable, IsPlayer,
  Money, Skills, Inventory, Building, Job, Character, Workstation,
  JobPerformance, Bed, Wall, Door, Attributes, BarSeat, RoughSpot,
  EntityKey, Reputation, JobTenure, FactionRole, Appearance, Transit,
  FlightHub,
  type Gender,
} from './traits'
import { transitTerminals } from '../data/transit'
import { flightHubs } from '../data/flights'
import { getWorldPlace } from '../data/worldMap'
import { getAppearanceOverride } from '../data/appearance'
import { generateAppearanceForName } from '../data/appearanceGen'
import { specialNpcs } from '../data/specialNpcs'
import { pickFreshName, pickRandomColor } from '../data/nameGen'
import type { FactionId } from '../data/factions'
import { markPathfindingDirty } from '../systems/pathfinding'
import { worldConfig, economyConfig } from '../config'
import {
  SeededRng, WORLD_SEED,
  generateApartmentCells, generateLuxuryCells,
  generateSectors,
} from '../procgen'
import type { DoorPlacement, PlacedSlot, SectorLayout } from '../procgen'
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
    // Doors must be flush to the *inside* of the building edge so they line
    // up with the wall segments they cut and don't bleed into the
    // neighbouring building's wall band on the pathfinding grid.
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
      // Walls must sit fully *inside* the building footprint so the 6px-thick
      // band stays within a single 16px pathfinding cell row/column. Centering
      // a wall on the building edge causes it to straddle a cell boundary and
      // block 2 rows, which can seal the 2-cell gap between adjacent buildings
      // (e.g. bar↕apt-office, apt-office↕apartment) and trap doors shut.
      if (side === 'n')      { wx = x + a; wy = y; ww = len; wh = WALL_T }
      else if (side === 's') { wx = x + a; wy = y + h - WALL_T; ww = len; wh = WALL_T }
      else if (side === 'w') { wx = x; wy = y + a; ww = WALL_T; wh = len }
      else                   { wx = x + w - WALL_T; wy = y + a; ww = WALL_T; wh = len }
      world.spawn(Wall({ x: wx, y: wy, w: ww, h: wh }))
    }
  }
  buildEdge('n'); buildEdge('s'); buildEdge('w'); buildEdge('e')
}

function encloseSlot(slot: PlacedSlot) {
  enclose(slot.rect, [slot.primaryDoor, ...slot.extraDoors])
}

let initialized = false

export function setupWorld() {
  if (initialized) return
  initialized = true

  for (const scene of scenes) {
    setActiveSceneId(scene.id)
    runSceneBootstrap(scene)
    markPathfindingDirty()
  }

  // Restore the active scene to the initial one — the player physically
  // spawns there, and Game.tsx / sim/loop.ts read `world` (active-scene
  // proxy) so leaving the active scene elsewhere would mis-render the
  // first frame.
  setActiveSceneId(initialSceneId)
}

function runSceneBootstrap(scene: SceneConfig): void {
  switch (scene.bootstrap) {
    case 'cityProcgen': bootstrapCityProcgen(scene); break
    case 'stub':        bootstrapStub(scene); break
  }
}

function bootstrapCityProcgen(scene: SceneConfig): void {
  // Sector layout consumes the first slice of RNG state; cell generators
  // consume the rest. A single shared stream keeps the layout deterministic
  // top-to-bottom; forking would require freezing the consumption order.
  const rng = SeededRng.fromString(WORLD_SEED)
  const sectors = generateSectors(rng)

  // Only the initial scene spawns the player; other cityProcgen scenes are
  // reached by flight, where the arrival tile is the entry point.
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
      EntityKey({ key: 'player' }),
    )
    setupAppearance(playerEnt, '新人')
  }

  const flopRent = economyConfig.prices.flopBed
  const dormRent = economyConfig.prices.dormBed
  const apartmentRent = economyConfig.prices.apartmentBed
  const luxuryRent = economyConfig.prices.luxuryBed

  spawnApartment(sectors, rng, apartmentRent)
  spawnFlop(sectors, flopRent)
  spawnDorm(sectors, dormRent)
  spawnLuxury(sectors, rng, luxuryRent)
  spawnFactory(sectors)
  spawnShop(sectors)
  spawnBar(sectors)
  spawnHr(sectors)
  spawnRealtor(sectors)
  spawnAeComplex(sectors)
  spawnSurvivalSources()
  spawnTransit()
  spawnAirportsForScene(scene.id)

  // NPCs spawn unemployed and homeless — they self-organize via the BT's
  // findJob / findHome branches. Board NPCs must spawn on streets, not
  // inside luxury cells: locked-cell-door semantics would trap them behind
  // a cell wall they don't have a bed claim for.
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
    // AE board / manager / reception roles spawn 360+ tiles from the city
    // and the natural job-seeking flow would never reach them — link the
    // workstation at world-init so they're seated from t=0.
    if (sn.workstation) {
      let target: Entity | null = null
      for (const wsEnt of world.query(Workstation)) {
        const ws = wsEnt.get(Workstation)!
        if (ws.specId === sn.workstation && ws.occupant === null) {
          target = wsEnt
          break
        }
      }
      if (target) {
        const ws = target.get(Workstation)!
        target.set(Workstation, { ...ws, occupant: ent })
        ent.set(Job, { workstation: target, unemployedSinceMs: 0 })
      }
    }
  }
  spawnAeWorkforce()
  spawnFoundingCivilians()
}

function bootstrapStub(scene: SceneConfig): void {
  spawnAirportsForScene(scene.id)
}

function spawnApartment(sectors: SectorLayout, rng: SeededRng, apartmentRent: number) {
  const slot = sectors.slots.get('apartment')!
  const { rect } = slot
  world.spawn(Building({ ...rect, label: '公寓' }))
  encloseSlot(slot)
  const layout = generateApartmentCells(rect, 4, rng)
  const beds = layout.cells.map((c, i) =>
    world.spawn(
      Position({ x: c.bedPos.x, y: c.bedPos.y }),
      Interactable({ kind: 'sleep', label: '床', fee: apartmentRent }),
      Bed({ tier: 'apartment', nightlyRent: apartmentRent }),
      EntityKey({ key: `bed-apartment-${i}` }),
    ),
  )
  for (const w of layout.walls) world.spawn(Wall({ ...w }))
  layout.cells.forEach((c, i) => {
    const dr = c.doorRect
    world.spawn(
      Position({ x: dr.x + dr.w / 2, y: dr.y + dr.h / 2 }),
      Door({ ...dr, orient: c.doorOrient, bedEntity: beds[i] }),
    )
  })
  // East end of the corridor stays clear of every cell-door cutout
  // regardless of the door positions the generator picked.
  const washX = layout.corridor.x + layout.corridor.w - TILE / 2
  const washY = layout.corridor.y + layout.corridor.h / 2
  world.spawn(
    Position({ x: washX, y: washY }),
    Interactable({ kind: 'wash', label: '洗手台' }),
  )
}

function spawnLuxury(sectors: SectorLayout, rng: SeededRng, luxuryRent: number) {
  const slot = sectors.slots.get('luxury')!
  const { rect } = slot
  world.spawn(Building({ ...rect, label: '高级公寓' }))
  encloseSlot(slot)
  const layout = generateLuxuryCells(rect, 3, rng)
  const beds = layout.cells.map((c, i) =>
    world.spawn(
      Position({ x: c.bedPos.x, y: c.bedPos.y }),
      Interactable({ kind: 'sleep', label: '高级床', fee: luxuryRent }),
      Bed({ tier: 'luxury', nightlyRent: luxuryRent }),
      EntityKey({ key: `bed-luxury-${i}` }),
    ),
  )
  for (const w of layout.walls) world.spawn(Wall({ ...w }))
  layout.cells.forEach((c, i) => {
    const dr = c.doorRect
    world.spawn(
      Position({ x: dr.x + dr.w / 2, y: dr.y + dr.h / 2 }),
      Door({ ...dr, orient: c.doorOrient, bedEntity: beds[i] }),
    )
  })
}

function spawnFlop(sectors: SectorLayout, flopRent: number) {
  const slot = sectors.slots.get('flop')!
  const { rect } = slot
  world.spawn(Building({ ...rect, label: '廉价旅馆' }))
  encloseSlot(slot)
  // Skip the leftmost tile column so a path from the door to any bed stays
  // clear.
  const bedY = rect.y + rect.h - TILE - WALL_T / 2
  for (let i = 0; i < 4; i++) {
    const bedX = rect.x + (i + 1) * TILE + TILE / 2
    world.spawn(
      Position({ x: bedX, y: bedY }),
      Interactable({ kind: 'sleep', label: '投币床', fee: flopRent }),
      Bed({ tier: 'flop', nightlyRent: flopRent }),
      EntityKey({ key: `bed-flop-${i}` }),
    )
  }
}

function spawnDorm(sectors: SectorLayout, dormRent: number) {
  const slot = sectors.slots.get('dorm')!
  const { rect } = slot
  world.spawn(Building({ ...rect, label: '工人宿舍' }))
  encloseSlot(slot)
  const bedY = rect.y + rect.h - TILE - WALL_T / 2
  const beds = [
    { x: rect.x + TILE * 2, y: bedY },
    { x: rect.x + TILE * 4, y: bedY },
  ]
  beds.forEach((b, i) => {
    world.spawn(
      Position({ x: b.x, y: b.y }),
      Interactable({ kind: 'sleep', label: '宿舍床', fee: dormRent }),
      Bed({ tier: 'dorm', nightlyRent: dormRent }),
      EntityKey({ key: `bed-dorm-${i}` }),
    )
  })
}

// Traffic flows N → manager office → interior door → factory floor → S.
// The interior door's x must equal both exterior doors' x for
// straight-through traversal — sectors.ts ties the s-extraDoor's offset to
// the n-primary's via `tiedToPrimary`.
function spawnFactory(sectors: SectorLayout) {
  const slot = sectors.slots.get('factory')!
  const { rect } = slot
  world.spawn(Building({ ...rect, label: '工厂' }))
  encloseSlot(slot)

  const dividerY = rect.y + TILE * 3
  const interiorDoorX = rect.x + slot.primaryDoor.offsetPx
  world.spawn(Wall({
    x: rect.x, y: dividerY,
    w: interiorDoorX - rect.x, h: WALL_T,
  }))
  world.spawn(Wall({
    x: interiorDoorX + TILE, y: dividerY,
    w: rect.x + rect.w - (interiorDoorX + TILE), h: WALL_T,
  }))
  world.spawn(
    Position({ x: interiorDoorX + TILE / 2, y: dividerY + WALL_T / 2 }),
    Door({ x: interiorDoorX, y: dividerY, w: TILE, h: WALL_T, orient: 'h' }),
  )

  // Manager desk is NPC-only — HRConversation hides this role and
  // interaction.ts ignores 'manager' kind for the player.
  const mgrDeskX = rect.x + Math.floor(rect.w / TILE / 2) * TILE + TILE / 2
  const mgrDeskY = rect.y + TILE * 2 - TILE / 2
  world.spawn(
    Position({ x: mgrDeskX, y: mgrDeskY }),
    Interactable({ kind: 'manager', label: '经理办公桌' }),
    Workstation({ specId: 'factory_manager', occupant: null }),
    EntityKey({ key: 'ws-factory_manager' }),
  )

  // A is the senior engineer; B/C/D are general labor.
  const widthTiles = Math.round(rect.w / TILE)
  const heightTiles = Math.round(rect.h / TILE)
  const stationXs = [
    rect.x + TILE * 2,
    rect.x + (widthTiles - 3) * TILE,
  ]
  const stationYs = [
    rect.y + TILE * 5,
    rect.y + (heightTiles - 3) * TILE,
  ]
  const stations = [
    { specId: 'factory_engineer',       x: stationXs[0], y: stationYs[0], label: '工位 A' },
    { specId: 'factory_worker_morning', x: stationXs[1], y: stationYs[0], label: '工位 B' },
    { specId: 'factory_worker_early',   x: stationXs[0], y: stationYs[1], label: '工位 C' },
    { specId: 'factory_worker_day',     x: stationXs[1], y: stationYs[1], label: '工位 D' },
  ]
  for (const s of stations) {
    world.spawn(
      Position({ x: s.x, y: s.y }),
      Interactable({ kind: 'work', label: s.label }),
      Workstation({ specId: s.specId, occupant: null }),
      EntityKey({ key: `ws-${s.specId}` }),
    )
  }
}

function spawnShop(sectors: SectorLayout) {
  const slot = sectors.slots.get('shop')!
  const { rect } = slot
  world.spawn(Building({ ...rect, label: '便利店' }))
  encloseSlot(slot)
  setShopRect(rect)
  const counter = { x: rect.x + Math.floor(rect.w / TILE / 2) * TILE + TILE / 2, y: rect.y + TILE * 2 }
  setLandmark('shopCounter', counter)
  // Cashier is anchored at `counter` while working, so routing buyers to
  // the same tile causes a pile-up. Buyers path here instead, and the buy
  // actions check distance to this point.
  setLandmark('shopApproach', { x: counter.x, y: counter.y + TILE })
  // Inbound buyers route here first so A* doesn't pick the closer south
  // door — the south door is reserved for outbound traffic via shopExit.
  const entryDoor = slot.extraDoors.find((d) => d.side === 'n')
  if (!entryDoor) throw new Error('shop slot must declare a north entry door')
  setLandmark('shopEntry', {
    x: rect.x + entryDoor.offsetPx + entryDoor.widthPx / 2,
    y: rect.y - TILE,
  })
  // Without this exit, the eat/drink branch would fire on the next BT
  // tick and anchor the buyer at shopApproach (action.kind='eating'/
  // 'drinking'), which combined with the 18px body separation pushes
  // every subsequent shopper out of the 6px buy radius — queues then
  // pile up south of approach and block the south door. Aligned with
  // the south door cutout so leavers naturally walk through it.
  setLandmark('shopExit', {
    x: rect.x + slot.primaryDoor.offsetPx + slot.primaryDoor.widthPx / 2,
    y: rect.y + rect.h + TILE,
  })
  world.spawn(
    Position({ x: counter.x, y: counter.y }),
    Interactable({ kind: 'shop', label: '柜台' }),
    Workstation({ specId: 'shop_morning_clerk', occupant: null }),
    EntityKey({ key: 'ws-shop_morning_clerk' }),
  )
  world.spawn(
    Position({ x: counter.x, y: counter.y }),
    Workstation({ specId: 'shop_afternoon_clerk', occupant: null }),
    EntityKey({ key: 'ws-shop_afternoon_clerk' }),
  )
}

function spawnBar(sectors: SectorLayout) {
  const slot = sectors.slots.get('bar')!
  const { rect } = slot
  world.spawn(Building({ ...rect, label: '酒吧' }))
  encloseSlot(slot)

  // Patrons interact with seats, not this counter. The 'work' Interactable
  // lets a hired-bartender player start their shift the same way as any
  // other worker; isBarOpen reads "bartender NPC at this position with
  // action.kind === 'working'".
  const counter = {
    x: rect.x + Math.floor(rect.w / TILE / 2) * TILE + TILE / 2,
    y: rect.y + TILE,
  }
  setLandmark('barCounter', counter)
  world.spawn(
    Position({ x: counter.x, y: counter.y }),
    Interactable({ kind: 'work', label: '吧台' }),
    Workstation({ specId: 'bartender', occupant: null }),
    EntityKey({ key: 'ws-bartender' }),
  )

  // Patron exclusivity is enforced in interaction.ts (player) and
  // ai/agent.ts (NPC).
  const seatY = rect.y + TILE * 2
  const seatSpacing = TILE
  const seatCount = 5
  const seatStartX = counter.x - ((seatCount - 1) * seatSpacing) / 2
  for (let i = 0; i < seatCount; i++) {
    world.spawn(
      Position({ x: seatStartX + i * seatSpacing, y: seatY }),
      Interactable({ kind: 'bar', label: '酒吧座位', fee: 10 }),
      BarSeat({ occupant: null }),
      EntityKey({ key: `barseat-${i}` }),
    )
  }

  // Just inside the south door regardless of where along the wall the door
  // landed — patrons cluster here when every seat is taken.
  const queue = {
    x: rect.x + slot.primaryDoor.offsetPx + slot.primaryDoor.widthPx / 2,
    y: rect.y + rect.h - WALL_T - 12,
  }
  setLandmark('barQueue', queue)
}

// HR clerk role is NPC-only (HRConversation filter).
function spawnHr(sectors: SectorLayout) {
  const slot = sectors.slots.get('hr')!
  const { rect } = slot
  world.spawn(Building({ ...rect, label: '市民人事局' }))
  encloseSlot(slot)
  const desk = { x: rect.x + Math.floor(rect.w / TILE / 2) * TILE + TILE / 2, y: rect.y + TILE * 1 + TILE / 2 }
  world.spawn(
    Position({ x: desk.x, y: desk.y }),
    Interactable({ kind: 'hr', label: '招聘窗口' }),
    Workstation({ specId: 'city_hr_clerk', occupant: null }),
    EntityKey({ key: 'ws-city_hr_clerk' }),
  )
}

// Reception lobby (cols 1–5) is public. The vertical wall at col-boundary
// 5/6 separates it from the interior, with a single faction-gated door at
// row 13 (Door.factionGate = 'anaheim'). Once past that gate, interior
// partitions are open cutouts — no Door entity needed because the gated
// wall has already filtered the traffic.
function spawnAeComplex(sectors: SectorLayout) {
  const slot = sectors.slots.get('aeComplex')!
  const { rect } = slot
  world.spawn(Building({ ...rect, label: '亚纳海姆电子' }))
  encloseSlot(slot)

  const partX = rect.x + 6 * TILE
  world.spawn(Wall({ x: partX, y: rect.y, w: WALL_T, h: 13 * TILE }))
  world.spawn(Wall({ x: partX, y: rect.y + 14 * TILE, w: WALL_T, h: 12 * TILE }))
  const gateX = partX
  const gateY = rect.y + 13 * TILE
  world.spawn(
    Position({ x: gateX + WALL_T / 2, y: gateY + TILE / 2 }),
    Door({ x: gateX, y: gateY, w: WALL_T, h: TILE, orient: 'v', factionGate: 'anaheim' }),
  )

  const interiorXStart = rect.x + 6 * TILE
  const interiorXEnd = rect.x + 27 * TILE
  const cutoutXCol = 13
  const cutoutX = rect.x + cutoutXCol * TILE
  function spawnHPartition(rowBoundary: number) {
    const y = rect.y + rowBoundary * TILE
    const leftW = cutoutX - interiorXStart
    if (leftW > 0) world.spawn(Wall({ x: interiorXStart, y, w: leftW, h: WALL_T }))
    const rightStart = cutoutX + TILE
    const rightW = interiorXEnd - rightStart
    if (rightW > 0) world.spawn(Wall({ x: rightStart, y, w: rightW, h: WALL_T }))
  }
  spawnHPartition(8)
  spawnHPartition(13)
  spawnHPartition(17)

  const officeColBoundaries = [11, 15, 19, 23]
  for (const colB of officeColBoundaries) {
    const x = rect.x + colB * TILE
    world.spawn(Wall({ x, y: rect.y + 1 * TILE, w: WALL_T, h: 7 * TILE }))
    world.spawn(Wall({ x, y: rect.y + 8 * TILE, w: WALL_T, h: 5 * TILE }))
  }

  world.spawn(Wall({
    x: rect.x + 13 * TILE,
    y: rect.y + 13 * TILE,
    w: WALL_T,
    h: 4 * TILE,
  }))

  const recX = rect.x + 3 * TILE + TILE / 2
  const recY = rect.y + 13 * TILE + TILE / 2
  world.spawn(
    Position({ x: recX, y: recY }),
    Interactable({ kind: 'aeReception', label: '前台' }),
    Workstation({ specId: 'ae_director', occupant: null }),
    EntityKey({ key: 'ws-ae_director' }),
  )

  const boardSpecs = ['ae_board_chair', 'ae_board_cfo', 'ae_board_cto', 'ae_board_coo', 'ae_board_cmo']
  const boardOfficeCols = [9, 13, 17, 21, 25]
  boardSpecs.forEach((specId, i) => {
    const x = rect.x + boardOfficeCols[i] * TILE - TILE / 2
    const y = rect.y + 4 * TILE + TILE / 2
    world.spawn(
      Position({ x, y }),
      Interactable({ kind: 'work', label: '董事办公桌' }),
      Workstation({ specId, occupant: null }),
      EntityKey({ key: `ws-${specId}` }),
    )
  })

  const managerSpecs = ['ae_floor_manager', 'ae_design_lead', 'ae_ops_manager', 'ae_hr_manager', 'ae_quality_manager']
  managerSpecs.forEach((specId, i) => {
    const x = rect.x + boardOfficeCols[i] * TILE - TILE / 2
    const y = rect.y + 10 * TILE + TILE / 2
    world.spawn(
      Position({ x, y }),
      Interactable({ kind: 'work', label: '经理办公桌' }),
      Workstation({ specId, occupant: null }),
      EntityKey({ key: `ws-${specId}` }),
    )
  })

  const gymCols = [8, 10, 12]
  gymCols.forEach((c, i) => {
    const x = rect.x + c * TILE + TILE / 2
    const y = rect.y + 14 * TILE + TILE / 2
    world.spawn(
      Position({ x, y }),
      Interactable({ kind: 'gym', label: i === 0 ? '跑步机' : i === 1 ? '杠铃' : '哑铃台' }),
      EntityKey({ key: `ae-gym-${i}` }),
    )
  })

  // interaction.ts has a special branch for the lounge tier so AE-affiliated
  // entities can self-claim (no realtor visit needed).
  const couchCols = [15, 18, 21, 24]
  couchCols.forEach((c, i) => {
    const x = rect.x + c * TILE + TILE
    const y = rect.y + 15 * TILE + TILE / 2
    world.spawn(
      Position({ x, y }),
      Interactable({ kind: 'sleep', label: '员工沙发', fee: 0 }),
      Bed({ tier: 'lounge', nightlyRent: 0, occupant: null, rentPaidUntilMs: 0 }),
      EntityKey({ key: `bed-lounge-${i}` }),
    )
  })
  // 'tap' Interactable but NOT registered as a roughSource, so vitals
  // doesn't apply the hygiene/HP penalty (corporate water = clean).
  world.spawn(
    Position({ x: rect.x + 26 * TILE, y: rect.y + 14 * TILE }),
    Interactable({ kind: 'tap', label: '饮水机' }),
    EntityKey({ key: 'ae-lounge-tap' }),
  )
  ;[15, 22].forEach((c, i) => {
    world.spawn(
      Position({ x: rect.x + c * TILE, y: rect.y + 14 * TILE }),
      Interactable({ kind: 'eat', label: '零食柜', fee: 0 }),
      EntityKey({ key: `ae-lounge-snack-${i}` }),
    )
  })

  // Engineers cluster near the top (closer to design / management wings);
  // assemblers dominate the bottom rows.
  const factoryStationCols = [9, 13, 17, 21, 25]
  const factoryStationRows = [18, 20, 22, 24]
  const factorySpecLayout: string[][] = [
    ['ae_senior_engineer', 'ae_engineer',  'ae_engineer',  'ae_engineer',  'ae_senior_engineer'],
    ['ae_engineer',        'ae_technician','ae_technician','ae_technician','ae_technician'],
    ['ae_technician',      'ae_assembler', 'ae_assembler', 'ae_assembler', 'ae_assembler'],
    ['ae_assembler',       'ae_assembler', 'ae_assembler', 'ae_assembler', 'ae_technician'],
  ]
  let stationIdx = 0
  for (let r = 0; r < factoryStationRows.length; r++) {
    for (let c = 0; c < factoryStationCols.length; c++) {
      const x = rect.x + factoryStationCols[c] * TILE - TILE / 2
      const y = rect.y + factoryStationRows[r] * TILE + TILE / 2
      const specId = factorySpecLayout[r][c]
      world.spawn(
        Position({ x, y }),
        Interactable({ kind: 'work', label: `工位 ${stationIdx + 1}` }),
        Workstation({ specId, occupant: null }),
        EntityKey({ key: `ws-ae-floor-${stationIdx}` }),
      )
      stationIdx += 1
    }
  }
}

// NPC-only desk role; NPCDialog detects the spec and surfaces the rent/buy
// menu, which spans every building tier.
function spawnRealtor(sectors: SectorLayout) {
  const slot = sectors.slots.get('aptOffice')!
  const { rect } = slot
  world.spawn(Building({ ...rect, label: '房产中介' }))
  encloseSlot(slot)
  const desk = { x: rect.x + Math.floor(rect.w / TILE / 2) * TILE + TILE / 2, y: rect.y + TILE * 1 + TILE / 2 }
  world.spawn(
    Position({ x: desk.x, y: desk.y }),
    Interactable({ kind: 'manager', label: '中介台' }),
    Workstation({ specId: 'realtor', occupant: null }),
    EntityKey({ key: 'ws-realtor' }),
  )
}

// Free to use, but every interaction tags the actor with RoughUse so
// vitals.ts applies a hygiene + small HP penalty during the action.
function spawnSurvivalSources() {
  const taps: Array<{ x: number; y: number }> = [
    { x: TILE * 13, y: TILE * 16 },
    { x: TILE * 25, y: TILE * 16 },
  ]
  for (const t of taps) {
    world.spawn(
      Position({ x: t.x, y: t.y }),
      Interactable({ kind: 'tap', label: '街边水龙头' }),
    )
    addRoughSource('tap', t)
  }

  const cans: Array<{ x: number; y: number }> = [
    { x: TILE * 11, y: TILE * 17 },
    { x: TILE * 27, y: TILE * 17 },
    { x: TILE * 19, y: TILE * 24 },
  ]
  for (const c of cans) {
    world.spawn(
      Position({ x: c.x, y: c.y }),
      Interactable({ kind: 'scavenge', label: '垃圾桶' }),
    )
    addRoughSource('scavenge', c)
  }

  // No Bed entity — sleep here resolves to BED_MULTIPLIERS.none (= 0.5)
  // automatically because the sleeper has no claimed bed. RoughSpot makes
  // each bench exclusive (one sleeper at a time).
  const benches: Array<{ x: number; y: number }> = [
    { x: TILE * 14, y: TILE * 24 },
    { x: TILE * 24, y: TILE * 24 },
  ]
  benches.forEach((b, i) => {
    world.spawn(
      Position({ x: b.x, y: b.y }),
      Interactable({ kind: 'rough', label: '街边长椅' }),
      RoughSpot({ occupant: null }),
      EntityKey({ key: `roughspot-${i}` }),
    )
    addRoughSource('rough', b)
  })
}

// Each scene only spawns the airports whose hub.sceneId matches it; hubs
// live in different koota worlds, so a startTown scene never instantiates
// the zumCity airport.
function spawnAirportsForScene(sceneId: SceneId): void {
  for (const hub of flightHubs) {
    if (hub.sceneId !== sceneId) continue
    const place = getWorldPlace(hub.placeId)
    if (!place) {
      throw new Error(`Flight hub ${hub.id} references unknown place ${hub.placeId}`)
    }
    const rect = {
      x: place.tileX * TILE,
      y: place.tileY * TILE,
      w: place.tileW * TILE,
      h: place.tileH * TILE,
    }
    world.spawn(Building({ ...rect, label: hub.nameZh }))

    const doorOffsetPx = Math.floor(place.tileW / 2) * TILE
    enclose(rect, [{ side: 'n', offsetPx: doorOffsetPx, widthPx: TILE }])

    const cx = hub.counterTile.x * TILE + TILE / 2
    const cy = hub.counterTile.y * TILE + TILE / 2
    world.spawn(
      Position({ x: cx, y: cy }),
      Interactable({ kind: 'ticketCounter', label: '售票处' }),
      FlightHub({ hubId: hub.id }),
      EntityKey({ key: `flighthub-${hub.id}` }),
    )
  }
}

function spawnTransit(): void {
  for (const t of transitTerminals) {
    const px = t.terminalTile.x * TILE
    const py = t.terminalTile.y * TILE
    world.spawn(
      Position({ x: px, y: py }),
      Interactable({ kind: 'transit', label: t.shortZh }),
      Transit({ terminalId: t.id }),
      EntityKey({ key: `transit-${t.id}` }),
    )
  }
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
  skills?: Partial<Record<'mechanics' | 'marksmanship' | 'athletics' | 'cooking' | 'medicine' | 'computers', number>>
  key?: string
  factionRole?: { faction: FactionId; role: 'staff' | 'manager' | 'board' }
  gender?: Gender
}

// AE is 360+ tiles from the city, so the natural job-seeking flow can't
// reach in any reasonable game-time — seed the factory's 20 stations
// directly. Workers are tagged FactionRole anaheim/staff so they pass the
// gated reception door. Must run after spawnAeComplex + the special-NPC
// loop, which seats the boards / managers / receptionist — leaving exactly
// the engineering ranks vacant for this pass.
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
    if (!profile) continue  // not an AE engineering station

    const wp = wsEnt.get(Position)!
    counter += 1
    const ent = spawnNPC({
      name: pickFreshName(world),
      color: pickRandomColor(),
      title: 'AE 员工',
      // Spawn at the workstation tile so the NPC starts adjacent — saves
      // them the 360-tile walk to their first shift.
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

// Tiered into starting-income brackets so the living-standards system has
// signal from t=0. The destitute tier intentionally spikes hunger/thirst
// to stress-test the survival path.
function spawnFoundingCivilians(): void {
  const ARRIVAL_X = TILE * 20
  const ARRIVAL_Y = TILE * 16
  const tiers: Array<{ count: number; money: () => number; fatigue: () => number; hunger?: () => number; thirst?: () => number; skills?: () => NPCSpec['skills'] }> = [
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

import type { Entity } from 'koota'
function setupAppearance(ent: Entity, name: string, gender?: Gender): void {
  const override = getAppearanceOverride(name)
  // If the override pins a gender, honor it during generation so body
  // proportions match. Otherwise use the explicit spec gender, otherwise
  // let the seed choose.
  const genderForGen = gender ?? (override?.gender as Gender | undefined)
  const base = generateAppearanceForName(name, { gender: genderForGen })
  const merged = { ...base, ...override }
  ent.add(Appearance(merged))
}

export function spawnNPC(spec: NPCSpec) {
  const baseSkills = { mechanics: 0, marksmanship: 0, athletics: 0, cooking: 0, medicine: 0, computers: 0 }
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
  // Must reset every scene's koota world, not just the active one. A bare
  // `world.reset()` (proxy → active scene) would leave inactive scenes'
  // entities behind, so a load-from-save would stack rebuilt entities on
  // top of the previous run's.
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
