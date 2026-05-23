// Hangar gate system. Each laid-out slot in fleetConfig.hangarMarkerLayout
// is materialised as an airport-style gate triple — kiosk, sign, board
// portal — that persists across docks/undocks. Ships dynamically bind to
// the first vacant gate of their hangarSlotClass; the sign reads the
// bound ship's name + owner, and the boarding portal is only enabled
// while a ship is bound. Vacant gates stay rendered (sign reads VACANT).
//
// Surface hangars host MS / smallCraft inside the open floor, so their
// gates lay out as a grid inside the building. Drydock hangars dock
// capital tonnage in orbit outside the building, so their gates flank
// the building's west / east walls as external concourse booths.

import type { World, Entity, TraitInstance } from 'koota'
import {
  Position, Interactable, EntityKey, TemplateRef,
  Building, Hangar, Ship, IsFlagshipMark, ShipMarker, Owner,
  GateSlot, GateKioskMark, GateSignMark, GateBoardMark,
} from '../ecs/traits'
import { getWorld } from '../ecs/world'
import { poiIdForHangarScene } from './shipDelivery'
import { getShipClass } from '../data/ship-classes'
import type { HangarSlotClass, HangarTier } from '../data/facilityTypes'
import { worldConfig, fleetConfig } from '../config'
import type { FloorGateLayout, WallGateLayout, GateLayout } from '../config/fleet'

const TILE = worldConfig.tilePx
const SHIP_SCENE_ID = 'playerShipInterior'

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
  // Anchor at the wall tile so the booth offsets place sign / kiosk /
  // board portal on the outside, with the board portal directly against
  // the wall (the airlock the player walks through to board).
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

function findHangar(world: World): {
  rect: { x: number; y: number; w: number; h: number }
  tier: HangarTier
} | null {
  for (const ent of world.query(Hangar, Building)) {
    const b = ent.get(Building)!
    const h = ent.get(Hangar)!
    return { rect: { x: b.x, y: b.y, w: b.w, h: b.h }, tier: h.tier }
  }
  return null
}

function gateNumberFor(slotClass: LaidOutSlotClass, indexInClass: number): string {
  const prefix = slotClass === 'capital'
    ? fleetConfig.gatePrefixCapital
    : fleetConfig.gatePrefixSmallCraft
  return `${prefix}${indexInClass + 1}`
}

function boardTemplateId(slotClass: HangarSlotClass, isFlagship: boolean): string {
  const tier = slotClass === 'capital' ? 'capital' : 'smallcraft'
  return isFlagship
    ? `gate-board-flagship-${tier}`
    : `gate-board-${tier}`
}

// Materialise the persistent gate triples for the hangar in this scene
// if they don't already exist. Idempotent — a second call is a no-op.
function ensureGates(world: World, sceneId: string): void {
  const existing = world.queryFirst(GateSlot)
  if (existing) return

  const hangar = findHangar(world)
  if (!hangar) return

  const tierLayout = fleetConfig.hangarMarkerLayout[hangar.tier]
  if (!tierLayout) return

  for (const slotClass of ['capital', 'smallCraft'] as LaidOutSlotClass[]) {
    const layout = tierLayout[slotClass]
    if (!layout) continue
    const slots = gateSlots(hangar.rect, layout)
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]
      const gateNumber = gateNumberFor(slotClass, i)
      const gateKeyBase = `gate-${sceneId}-${gateNumber}`

      // Sign — carries the gate label as a Pixi text overlay (3-line:
      // gate id / ship name or VACANT / owner). Doubles as a fallback
      // Interactable so the proximity scan opens the panel from either
      // the sign or the kiosk tile. Position + template are picked from
      // the per-class layout (wide horizontal for floor placement, narrow
      // vertical for wall placement).
      world.spawn(
        Position({
          x: slot.x + layout.signOffsetTiles.x * TILE,
          y: slot.y + layout.signOffsetTiles.y * TILE,
        }),
        Interactable({ kind: 'gateTerminal', label: gateNumber, fee: 0 }),
        GateSlot({ gateNumber, slotClass, boundShipKey: '' }),
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
        GateSlot({ gateNumber, slotClass, boundShipKey: '' }),
        GateKioskMark(),
        EntityKey({ key: `${gateKeyBase}-kiosk` }),
        TemplateRef({ id: 'gate-kiosk' }),
      )

      // Board portal — Interactable boardShip/inspectShip, ShipMarker
      // is added by the sync pass only while a ship is bound (vacant
      // portals carry no Interactable so the proximity scan ignores
      // them). Spawn it without those traits; the sync pass owns the
      // bind/unbind flip.
      world.spawn(
        Position({
          x: slot.x + layout.boardOffsetTiles.x * TILE,
          y: slot.y + layout.boardOffsetTiles.y * TILE,
        }),
        GateSlot({ gateNumber, slotClass, boundShipKey: '' }),
        GateBoardMark(),
        EntityKey({ key: `${gateKeyBase}-board` }),
      )
    }
  }
}

interface ExpectedShip {
  ent: Entity
  shipKey: string
  isFlagship: boolean
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
    out.push({
      ent,
      shipKey: ent.get(EntityKey)!.key,
      isFlagship: ent.has(IsFlagshipMark),
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

function collectGates(world: World): Map<string, GateTriple> {
  const map = new Map<string, Partial<GateTriple>>()
  for (const ent of world.query(GateSlot)) {
    const slot = ent.get(GateSlot)!
    const t = map.get(slot.gateNumber) ?? {}
    if (ent.has(GateKioskMark)) t.kiosk = ent
    else if (ent.has(GateSignMark)) t.sign = ent
    else if (ent.has(GateBoardMark)) t.board = ent
    t.slot = slot
    map.set(slot.gateNumber, t)
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

function applyBoardPortal(
  triple: GateTriple,
  info: ExpectedShip | null,
): void {
  const board = triple.board
  if (!info) {
    if (board.has(Interactable)) board.remove(Interactable)
    if (board.has(ShipMarker)) board.remove(ShipMarker)
    if (board.has(TemplateRef)) board.remove(TemplateRef)
    return
  }
  const cls = getShipClass(info.templateId)
  const tplId = boardTemplateId(info.slotClass, info.isFlagship)
  if (!board.has(Interactable)) board.add(Interactable)
  board.set(Interactable, {
    kind: info.isFlagship ? 'boardShip' : 'inspectShip',
    label: cls.nameZh,
    fee: 0,
  })
  if (!board.has(ShipMarker)) board.add(ShipMarker)
  board.set(ShipMarker, { shipKey: info.shipKey })
  if (!board.has(TemplateRef)) board.add(TemplateRef)
  board.set(TemplateRef, { id: tplId })
}

export function syncShipMarkers(world: World, sceneId: string): void {
  const poiId = poiIdForHangarScene(sceneId)
  if (!poiId) return
  ensureGates(world, sceneId)

  const gates = collectGates(world)
  if (gates.size === 0) return

  const expected = expectedDockedShips(poiId)

  // Bucket gates by slotClass; carry the gate-number order so we always
  // assign the lowest-numbered vacant gate (deterministic + readable).
  const gatesByClass: Record<LaidOutSlotClass, GateTriple[]> = {
    capital: [],
    smallCraft: [],
  }
  for (const t of gates.values()) {
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
  for (const t of gates.values()) {
    if (t.slot.boundShipKey && stillDocked.has(t.slot.boundShipKey)) {
      stickyByClass[t.slot.slotClass].set(t.slot.boundShipKey, t)
    } else if (t.slot.boundShipKey) {
      writeBinding(t, '')
      applyBoardPortal(t, null)
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
    applyBoardPortal(triple, ship)
  }

  // Refresh board portal art for sticky bindings (handles the case where
  // a ship's flagship-marker flipped while the binding stayed put — e.g.
  // post-switch-flagship in the future).
  for (const ship of expected) {
    const triple = stickyByClass[ship.laidOutClass].get(ship.shipKey)
    if (!triple) continue
    applyBoardPortal(triple, ship)
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
