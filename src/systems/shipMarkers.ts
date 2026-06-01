// Hangar gate system. Each laid-out slot in fleetConfig.hangarMarkerLayout
// is materialised as an airport-style gate triple — kiosk, sign, board
// portal — that persists across docks/undocks. Ships dynamically bind to
// the first vacant gate of their hangarSlotClass; the sign reads the
// bound ship's name + owner, and the boarding pad at the far end of the
// boarding bridge is only enabled while a ship is bound.
//
// Surface hangars host MS / smallCraft inside the open floor, so their
// gates lay out as a grid inside the building. Drydock hangars dock
// capital tonnage in orbit outside the building, so their gates flank
// the building's west / east walls as external concourse booths and the
// boarding pad sits at the far end of a walled boarding bridge that
// extends from the booth out to the scene's edge. A door at the bridge
// mouth gates passage — locked when the bound ship isn't player-owned,
// open when it is.

import type { World, Entity, TraitInstance } from 'koota'
import {
  Position, Interactable, EntityKey, TemplateRef,
  Building, Hangar, Ship, IsFlagshipMark, ShipMarker, Owner,
  GateSlot, GateKioskMark, GateSignMark, GateBoardMark,
  Wall, Door,
} from '../ecs/traits'
import { getWorld } from '../ecs/world'
import { poiIdForHangar } from '../data/pois'
import { getShipClass } from '../data/ship-classes'
import type { HangarSlotClass, HangarTier } from '../data/facilityTypes'
import { worldConfig, fleetConfig } from '../config'
import type { FloorGateLayout, WallGateLayout, GateLayout } from '../config/fleet'
import { getSceneConfig } from '../data/scenes'
import { markPathfindingDirty } from './pathfinding'

const TILE = worldConfig.tilePx
const WALL_T = worldConfig.wallThicknessPx
const HALF_TILE = TILE / 2
const SHIP_SCENE_ID = 'playerShipInterior'

// Boarding-bridge lane half-height (in px). The walkway spans 2*LANE_HALF
// minus the two flanking walls. Picked so adjacent smallCraft corridors
// (2-tile spacing) share their flanking wall position flush — no gap
// between corridors a player could squeeze through to bypass the door.
const LANE_HALF = TILE

type LaidOutSlotClass = 'capital' | 'smallCraft'

function layoutClassFor(slotClass: HangarSlotClass): LaidOutSlotClass {
  return slotClass === 'capital' ? 'capital' : 'smallCraft'
}

interface MarkerSlot {
  x: number
  y: number
}

function floorSlots(
  building: { x: number; y: number; w: number; h: number },
  layout: FloorGateLayout,
): MarkerSlot[] {
  const widthTiles = building.w / TILE
  const availableTiles = widthTiles - layout.startTileX * 2
  const cols = Math.max(1, Math.floor(availableTiles / layout.strideTiles) + 1)
  const startX = building.x + layout.startTileX * TILE
  const slots: MarkerSlot[] = []
  for (const rowOffsetTiles of layout.rowOffsetsTiles) {
    const y = building.y + rowOffsetTiles * TILE
    for (let c = 0; c < cols; c++) {
      slots.push({ x: startX + c * layout.strideTiles * TILE, y })
    }
  }
  return slots
}

function wallSlots(
  building: { x: number; y: number; w: number; h: number },
  layout: WallGateLayout,
): MarkerSlot[] {
  // Anchor at the wall tile so the booth offsets place sign / kiosk on
  // the outside; the boarding pad lands at the far end of the bridge
  // extending from the booth to the scene's edge.
  const anchorX = layout.side === 'w' ? building.x : building.x + building.w
  const slots: MarkerSlot[] = []
  for (const rowOffsetTiles of layout.rowOffsetsTiles) {
    slots.push({ x: anchorX, y: building.y + rowOffsetTiles * TILE })
  }
  return slots
}

function gateSlots(
  building: { x: number; y: number; w: number; h: number },
  layout: GateLayout,
): MarkerSlot[] {
  return layout.placement === 'wall'
    ? wallSlots(building, layout)
    : floorSlots(building, layout)
}

interface HangarInfo {
  rect: { x: number; y: number; w: number; h: number }
  tier: HangarTier
  poiId: string
}

// Every hangar in the scene, each with the POI it serves. A scene may host
// more than one (the surface yard + the orbital drydock, both vonBraunCity).
function findHangars(world: World, sceneId: string): HangarInfo[] {
  const out: HangarInfo[] = []
  for (const ent of world.query(Hangar, Building)) {
    const b = ent.get(Building)!
    const h = ent.get(Hangar)!
    const poiId = poiIdForHangar(sceneId, b)
    if (!poiId) continue
    out.push({ rect: { x: b.x, y: b.y, w: b.w, h: b.h }, tier: h.tier, poiId })
  }
  return out
}

function gateNumberFor(slotClass: LaidOutSlotClass, indexInClass: number): string {
  const prefix = slotClass === 'capital'
    ? fleetConfig.gatePrefixCapital
    : fleetConfig.gatePrefixSmallCraft
  return `${prefix}${indexInClass + 1}`
}

// Boarding-bridge geometry for a single wall-placement gate slot. Walls
// flank a 2*LANE_HALF tall lane (a 1-tile walkway with half-tile margins
// that smallCraft corridors share with their neighbours). Door sits at
// the corridor mouth (the booth side) and the boarding pad lands a half
// tile in from the scene edge so the player can stand on it.
interface BridgeGeometry {
  wallTop:    { x: number; y: number; w: number; h: number }
  wallBottom: { x: number; y: number; w: number; h: number }
  door:       { x: number; y: number; w: number; h: number }
  padCenter:  { x: number; y: number }
}

function computeBridgeGeometry(
  slot: MarkerSlot,
  layout: WallGateLayout,
  sceneTilesX: number,
): BridgeGeometry {
  const sceneEdgeX = layout.side === 'w' ? 0 : sceneTilesX * TILE
  const signX = slot.x + layout.signOffsetTiles.x * TILE

  let corridorStartX: number
  let corridorEndX: number
  let mouthX: number
  let padX: number
  if (layout.side === 'w') {
    // Bridge runs west from the booth (sign is the westernmost item) out
    // to the map edge. Mouth sits half a tile west of the sign center
    // so the door doesn't overlap the sign tile.
    corridorEndX = signX - HALF_TILE
    corridorStartX = sceneEdgeX
    mouthX = corridorEndX - WALL_T
    padX = sceneEdgeX + HALF_TILE
  } else {
    corridorStartX = signX + HALF_TILE
    corridorEndX = sceneEdgeX
    mouthX = corridorStartX
    padX = sceneEdgeX - HALF_TILE
  }

  const x0 = Math.min(corridorStartX, corridorEndX)
  const len = Math.abs(corridorEndX - corridorStartX)
  const doorY = slot.y - LANE_HALF + WALL_T
  const doorH = 2 * LANE_HALF - 2 * WALL_T

  return {
    wallTop:    { x: x0, y: slot.y - LANE_HALF,         w: len, h: WALL_T },
    wallBottom: { x: x0, y: slot.y + LANE_HALF - WALL_T, w: len, h: WALL_T },
    door:       { x: mouthX, y: doorY, w: WALL_T, h: doorH },
    padCenter:  { x: padX, y: slot.y },
  }
}

// Materialise the persistent gate triples + boarding-bridge geometry for
// the hangar in this scene if they don't already exist. Idempotent — a
// second call is a no-op.
function ensureGates(world: World, sceneId: string): void {
  const existing = world.queryFirst(GateSlot)
  if (existing) return

  const hangars = findHangars(world, sceneId)
  if (hangars.length === 0) return

  const scene = getSceneConfig(sceneId)
  const sceneTilesX = scene.tilesX
  let spawnedBridgeEntities = false

  for (const hangar of hangars) {
    const tierLayout = fleetConfig.hangarMarkerLayout[hangar.tier]
    if (!tierLayout) continue
    // Gate identity is (poiId, gateNumber): two hangars in one scene each
    // start their numbering at C1 / S1, kept distinct by the POI prefix.
    const poiId = hangar.poiId

    for (const slotClass of ['capital', 'smallCraft'] as LaidOutSlotClass[]) {
      const layout = tierLayout[slotClass]
      if (!layout) continue
      const slots = gateSlots(hangar.rect, layout)
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i]
        const gateNumber = gateNumberFor(slotClass, i)
        const gateKeyBase = `gate-${sceneId}-${poiId}-${gateNumber}`

        // Sign — carries the gate label as a Pixi text overlay (3-line:
        // gate id / ship name or VACANT / owner). Doubles as a fallback
        // Interactable so the proximity scan opens the panel from either
        // the sign or the kiosk tile.
        world.spawn(
          Position({
            x: slot.x + layout.signOffsetTiles.x * TILE,
            y: slot.y + layout.signOffsetTiles.y * TILE,
          }),
          Interactable({ kind: 'gateTerminal', label: gateNumber, fee: 0 }),
          GateSlot({ gateNumber, slotClass, boundShipKey: '', poiId }),
          GateSignMark(),
          EntityKey({ key: `${gateKeyBase}-sign` }),
          TemplateRef({ id: layout.signTemplate }),
        )

        // Kiosk — Interactable gateTerminal. Press E to open the panel
        // (vacant-gate branch surfaces a toast; bound gate opens the
        // GateTerminalPanel scoped to the bound ship).
        world.spawn(
          Position({
            x: slot.x + layout.terminalOffsetTiles.x * TILE,
            y: slot.y + layout.terminalOffsetTiles.y * TILE,
          }),
          Interactable({ kind: 'gateTerminal', label: gateNumber, fee: 0 }),
          GateSlot({ gateNumber, slotClass, boundShipKey: '', poiId }),
          GateKioskMark(),
          EntityKey({ key: `${gateKeyBase}-kiosk` }),
          TemplateRef({ id: 'gate-kiosk' }),
        )

        // Boarding pad — sits at the far end of the bridge near the scene
        // edge. The sync pass toggles its Interactable + ShipMarker +
        // visual template based on the bound ship's ownership. Vacant
        // gates carry no Interactable so the proximity scan ignores them.
        if (layout.placement === 'wall') {
          const bridge = computeBridgeGeometry(slot, layout, sceneTilesX)

          world.spawn(
            Position({ x: bridge.padCenter.x, y: bridge.padCenter.y }),
            GateSlot({ gateNumber, slotClass, boundShipKey: '', poiId }),
            GateBoardMark(),
            EntityKey({ key: `${gateKeyBase}-board` }),
          )

          // Bridge walls — top + bottom of the walkway. Persistent: the
          // bridge exists whether or not a ship is bound; only the door
          // state and the boarding pad's interactable toggle on bind.
          world.spawn(
            Wall(bridge.wallTop),
            TemplateRef({ id: 'wall-default' }),
            EntityKey({ key: `${gateKeyBase}-bridge-wall-n` }),
          )
          world.spawn(
            Wall(bridge.wallBottom),
            TemplateRef({ id: 'wall-default' }),
            EntityKey({ key: `${gateKeyBase}-bridge-wall-s` }),
          )

          // Bridge door — closed (locked + ship-locked template) until
          // the sync pass discovers a player-owned ship bound to this
          // gate. orient='v' for the wall-placement layout: the corridor
          // runs east-west, the door is a vertical panel spanning the
          // walkway height.
          world.spawn(
            Position({
              x: bridge.door.x + bridge.door.w / 2,
              y: bridge.door.y + bridge.door.h / 2,
            }),
            Door({
              x: bridge.door.x, y: bridge.door.y,
              w: bridge.door.w, h: bridge.door.h,
              orient: 'v',
              bedEntity: null, factionGate: null, locked: true,
            }),
            TemplateRef({ id: 'door-ship-locked' }),
            EntityKey({ key: `${gateKeyBase}-bridge-door` }),
          )

          spawnedBridgeEntities = true
        } else {
          // Floor placement (surface hangars) — keep the legacy in-booth
          // board portal entity. The bridge concept is drydock-only; surface
          // hangars host smallCraft inside the open floor so there's no
          // wall to break or edge to extend a corridor to.
          world.spawn(
            Position({
              x: slot.x + layout.boardOffsetTiles.x * TILE,
              y: slot.y + layout.boardOffsetTiles.y * TILE,
            }),
            GateSlot({ gateNumber, slotClass, boundShipKey: '', poiId }),
            GateBoardMark(),
            EntityKey({ key: `${gateKeyBase}-board` }),
          )
        }
      }
    }
  }

  if (spawnedBridgeEntities) {
    // New Wall + Door entities — pathfinder's wall grid + per-requester
    // door blocking are stale until the next setBlockedFor pass.
    markPathfindingDirty()
  }
}

interface ExpectedShip {
  ent: Entity
  shipKey: string
  isFlagship: boolean
  playerOwned: boolean
  templateId: string
  slotClass: HangarSlotClass
  laidOutClass: LaidOutSlotClass
}

function expectedDockedShips(poiId: string): ExpectedShip[] {
  const shipWorld = getWorld(SHIP_SCENE_ID)
  const out: ExpectedShip[] = []
  for (const ent of shipWorld.query(Ship, EntityKey)) {
    const s = ent.get(Ship)!
    if (s.dockedAtPoiId !== poiId) continue
    const cls = getShipClass(s.templateId)
    const owner = ent.get(Owner)
    out.push({
      ent,
      shipKey: ent.get(EntityKey)!.key,
      isFlagship: ent.has(IsFlagshipMark),
      playerOwned: owner?.kind === 'character',
      templateId: s.templateId,
      slotClass: cls.hangarSlotClass,
      laidOutClass: layoutClassFor(cls.hangarSlotClass),
    })
  }
  return out
}

interface GateTriple {
  kiosk: Entity
  sign: Entity
  board: Entity
  slot: TraitInstance<typeof GateSlot>
}

// Keyed by `${poiId}:${gateNumber}` so two hangars in one scene (each
// numbering its gates from C1 / S1) don't collide.
function gateKey(slot: TraitInstance<typeof GateSlot>): string {
  return `${slot.poiId}:${slot.gateNumber}`
}

function collectGates(world: World): Map<string, GateTriple> {
  const map = new Map<string, Partial<GateTriple>>()
  for (const ent of world.query(GateSlot)) {
    const slot = ent.get(GateSlot)!
    const key = gateKey(slot)
    const t = map.get(key) ?? {}
    if (ent.has(GateKioskMark)) t.kiosk = ent
    else if (ent.has(GateSignMark)) t.sign = ent
    else if (ent.has(GateBoardMark)) t.board = ent
    t.slot = slot
    map.set(key, t)
  }
  const out = new Map<string, GateTriple>()
  for (const [k, v] of map) {
    if (v.kiosk && v.sign && v.board && v.slot) out.set(k, v as GateTriple)
  }
  return out
}

function writeBinding(triple: GateTriple, shipKey: string): void {
  const next = { ...triple.slot, boundShipKey: shipKey }
  triple.kiosk.set(GateSlot, next)
  triple.sign.set(GateSlot, next)
  triple.board.set(GateSlot, next)
}

// Find the boarding-bridge door entity associated with this gate. Returns
// null for floor-placement gates (surface hangars) since those have no
// bridge.
function findBridgeDoor(world: World, sceneId: string, poiId: string, gateNumber: string): Entity | null {
  const key = `gate-${sceneId}-${poiId}-${gateNumber}-bridge-door`
  for (const e of world.query(Door, EntityKey)) {
    if (e.get(EntityKey)!.key === key) return e
  }
  return null
}

function applyBoardPortal(
  world: World,
  sceneId: string,
  triple: GateTriple,
  info: ExpectedShip | null,
): void {
  const board = triple.board
  const door = findBridgeDoor(world, sceneId, triple.slot.poiId, triple.slot.gateNumber)

  if (!info) {
    if (board.has(Interactable)) board.remove(Interactable)
    if (board.has(ShipMarker)) board.remove(ShipMarker)
    if (board.has(TemplateRef)) board.remove(TemplateRef)
    if (door) {
      const d = door.get(Door)!
      door.set(Door, { ...d, locked: true })
      if (door.has(TemplateRef)) door.set(TemplateRef, { id: 'door-ship-locked' })
      markPathfindingDirty()
    }
    return
  }

  const cls = getShipClass(info.templateId)
  const padTpl = info.playerOwned ? 'gate-board-pad-flagship' : 'gate-board-pad'
  if (!board.has(Interactable)) board.add(Interactable)
  board.set(Interactable, {
    kind: info.playerOwned ? 'boardShip' : 'inspectShip',
    label: cls.nameZh,
    fee: 0,
  })
  if (!board.has(ShipMarker)) board.add(ShipMarker)
  board.set(ShipMarker, { shipKey: info.shipKey })
  if (!board.has(TemplateRef)) board.add(TemplateRef)
  board.set(TemplateRef, { id: padTpl })

  if (door) {
    const d = door.get(Door)!
    const wantLocked = !info.playerOwned
    if (d.locked !== wantLocked) {
      door.set(Door, { ...d, locked: wantLocked })
      door.set(TemplateRef, { id: wantLocked ? 'door-ship-locked' : 'door-open' })
      markPathfindingDirty()
    }
  }
}

export function syncShipMarkers(world: World, sceneId: string): void {
  ensureGates(world, sceneId)

  const gates = collectGates(world)
  if (gates.size === 0) return

  // A scene may host hangars at several POIs (surface yard + orbital drydock
  // in vonBraunCity). Bind each POI's docked ships only to that POI's gates,
  // so a capital hull at the drydock can't claim a surface-yard gate.
  const poiIds = new Set<string>()
  for (const t of gates.values()) poiIds.add(t.slot.poiId)

  for (const poiId of poiIds) {
    if (!poiId) continue
    const poiGates = [...gates.values()].filter((t) => t.slot.poiId === poiId)
    bindPoiGates(world, sceneId, poiId, poiGates)
  }
}

// Assign the ships docked at `poiId` to that POI's gates. Lifted out of
// syncShipMarkers so multiple POIs in one scene each run an independent pass.
function bindPoiGates(
  world: World, sceneId: string, poiId: string, poiGates: GateTriple[],
): void {
  const expected = expectedDockedShips(poiId)

  // Bucket gates by slotClass; carry the gate-number order so we always
  // assign the lowest-numbered vacant gate (deterministic + readable).
  const gatesByClass: Record<LaidOutSlotClass, GateTriple[]> = {
    capital: [],
    smallCraft: [],
  }
  for (const t of poiGates) {
    gatesByClass[t.slot.slotClass].push(t)
  }
  for (const cls of ['capital', 'smallCraft'] as LaidOutSlotClass[]) {
    gatesByClass[cls].sort((a, b) => a.slot.gateNumber.localeCompare(b.slot.gateNumber))
  }

  // Preserve current bindings where the ship is still docked; otherwise
  // unbind so the slot becomes free for the next assignment pass.
  const stillDocked = new Set(expected.map((e) => e.shipKey))
  const stickyByClass: Record<LaidOutSlotClass, Map<string, GateTriple>> = {
    capital: new Map(), smallCraft: new Map(),
  }
  for (const t of poiGates) {
    if (t.slot.boundShipKey && stillDocked.has(t.slot.boundShipKey)) {
      stickyByClass[t.slot.slotClass].set(t.slot.boundShipKey, t)
    } else if (t.slot.boundShipKey) {
      writeBinding(t, '')
      applyBoardPortal(world, sceneId, t, null)
    } else {
      // First-time vacant — make sure the bridge door starts locked
      // (idempotent; door defaults to locked at spawn).
      applyBoardPortal(world, sceneId, t, null)
    }
  }

  // Assign remaining ships to the first vacant gate of their class in
  // gate-number order.
  const remaining = expected.filter((e) => !stickyByClass[e.laidOutClass].has(e.shipKey))
  const cursors: Record<LaidOutSlotClass, number> = { capital: 0, smallCraft: 0 }
  for (const ship of remaining) {
    const pool = gatesByClass[ship.laidOutClass]
    while (cursors[ship.laidOutClass] < pool.length
      && pool[cursors[ship.laidOutClass]].slot.boundShipKey !== '') {
      cursors[ship.laidOutClass] += 1
    }
    if (cursors[ship.laidOutClass] >= pool.length) continue
    const triple = pool[cursors[ship.laidOutClass]]
    cursors[ship.laidOutClass] += 1
    writeBinding(triple, ship.shipKey)
    applyBoardPortal(world, sceneId, triple, ship)
  }

  // Refresh board portal art for sticky bindings — covers the case where
  // a ship's flagship-marker or ownership flipped while the binding stayed
  // put (e.g. post-switch-flagship, or a faction ship newly delivered into
  // player ownership).
  for (const ship of expected) {
    const triple = stickyByClass[ship.laidOutClass].get(ship.shipKey)
    if (!triple) continue
    applyBoardPortal(world, sceneId, triple, ship)
  }
}

// Lookup helpers used by interaction.ts and the sign renderer.
export function findShipByKey(shipKey: string): Entity | null {
  if (!shipKey) return null
  const shipWorld = getWorld(SHIP_SCENE_ID)
  for (const e of shipWorld.query(Ship, EntityKey)) {
    if (e.get(EntityKey)!.key === shipKey) return e
  }
  return null
}

export function shipOwnerLabel(shipEnt: Entity | null): string {
  if (!shipEnt) return ''
  const o = shipEnt.get(Owner)
  if (!o) return ''
  if (o.kind === 'state') return '国营'
  if (o.kind === 'faction') return '阵营'
  return '玩家'
}

// Resolve the boarding-pad arrival position for a ship docked at this
// scene's POI. Returns null when the ship isn't bound to a wall-placement
// gate (e.g. surface hangar — no bridge to disembark down). Used by the
// disembark path to drop the player at the end of their flagship's bridge
// rather than at the scene's airport placement.
export function findBoardingPadPx(sceneId: string, shipKey: string): { x: number; y: number } | null {
  if (!shipKey) return null
  const w = getWorld(sceneId)
  for (const e of w.query(GateSlot, GateBoardMark, Position)) {
    const slot = e.get(GateSlot)!
    if (slot.boundShipKey !== shipKey) continue
    const p = e.get(Position)!
    return { x: p.x, y: p.y }
  }
  return null
}
