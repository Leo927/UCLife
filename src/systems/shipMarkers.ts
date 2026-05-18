// Sync ship markers in the active hangar scene against the ships docked
// at that scene's POI. Fleet ships live in the playerShipInterior world
// alongside the flagship; this system mirrors them as Interactable
// markers in the host scene so the hangar floor reads as "your hull is
// parked here" — clickable for the flagship (board interior) and
// inspectable for fleet ships (board interior is a 6.3+ concern).

import type { World, Entity } from 'koota'
import {
  Position, Interactable, EntityKey, TemplateRef,
  Building, Hangar, Ship, IsFlagshipMark, ShipMarker,
} from '../ecs/traits'
import { getWorld } from '../ecs/world'
import { poiIdForHangarScene } from './shipDelivery'
import { getShipClass } from '../data/ship-classes'
import type { HangarSlotClass } from '../data/facilityTypes'
import { worldConfig, fleetConfig } from '../config'

const TILE = worldConfig.tilePx
const SHIP_SCENE_ID = 'playerShipInterior'

// Slot classes that get their own row layout. `ms` slots reuse the
// smallCraft row layout — no ship today declares `hangarSlotClass: 'ms'`
// (6.2.5+ MS-aboard mechanic adds them), so the fallback is harmless.
type LaidOutSlotClass = 'capital' | 'smallCraft'

function layoutClassFor(slotClass: HangarSlotClass): LaidOutSlotClass {
  return slotClass === 'capital' ? 'capital' : 'smallCraft'
}

interface MarkerSlot {
  x: number
  y: number
}

// Lay out per-slotClass ship-parking slots inside the hangar building.
// Capitals get a dedicated wide-stride row at the top of the floor so
// a Pegasus-class hull dominates the visual space; smallCraft fill
// narrower rows below. Layout numbers come from fleetConfig so the
// drydock's 4-capital + 12-smallCraft envelope fits without spilling
// onto the worker grid / cafeteria / bunk strip along the south wall.
function hangarMarkerSlots(
  building: { x: number; y: number; w: number; h: number },
  laidOutClass: LaidOutSlotClass,
): MarkerSlot[] {
  const layout = fleetConfig.hangarMarkerLayout[laidOutClass]
  const slots: MarkerSlot[] = []
  const widthTiles = building.w / TILE
  const availableTiles = widthTiles - layout.startTileX * 2
  const cols = Math.max(1, Math.floor(availableTiles / layout.strideTiles) + 1)
  const startX = building.x + layout.startTileX * TILE
  for (const rowOffsetTiles of layout.rowOffsetsTiles) {
    const y = building.y + rowOffsetTiles * TILE
    for (let c = 0; c < cols; c++) {
      slots.push({ x: startX + c * layout.strideTiles * TILE, y })
    }
  }
  return slots
}

function markerTemplateId(slotClass: HangarSlotClass, isFlagship: boolean): string {
  // 'ms' falls back to smallCraft templates until 6.2.5+ ships an MS
  // hangarSlotClass + dedicated MS-marker art.
  const tier = slotClass === 'capital' ? 'capital' : 'smallcraft'
  return isFlagship
    ? `docked-flagship-marker-${tier}`
    : `docked-ship-marker-${tier}`
}

// Find the first Hangar-bearing building in the scene. Scenes today host
// at most one hangar facility (vonBraunCity → state hangar, granadaDrydock
// → drydock); when that constraint relaxes the marker layout will need to
// scope per-building, but a single rect is enough for 6.2.A.
function findHangarBuilding(world: World): { x: number; y: number; w: number; h: number } | null {
  for (const ent of world.query(Hangar, Building)) {
    const b = ent.get(Building)!
    return { x: b.x, y: b.y, w: b.w, h: b.h }
  }
  return null
}

export function syncShipMarkers(world: World, sceneId: string): void {
  const poiId = poiIdForHangarScene(sceneId)
  if (!poiId) return
  const hangarRect = findHangarBuilding(world)
  if (!hangarRect) return

  const shipWorld = getWorld(SHIP_SCENE_ID)

  // Build the set of ship keys that should be markered in this scene,
  // bucketed by laid-out slot class so capitals and smallCraft each draw
  // from their own row layout.
  interface ExpectedShip {
    ent: Entity
    isFlagship: boolean
    templateId: string
    slotClass: HangarSlotClass
    laidOutClass: LaidOutSlotClass
  }
  const expected = new Map<string, ExpectedShip>()
  for (const shipEnt of shipWorld.query(Ship, EntityKey)) {
    const s = shipEnt.get(Ship)!
    if (s.dockedAtPoiId !== poiId) continue
    const key = shipEnt.get(EntityKey)!.key
    const cls = getShipClass(s.templateId)
    expected.set(key, {
      ent: shipEnt,
      isFlagship: shipEnt.has(IsFlagshipMark),
      templateId: s.templateId,
      slotClass: cls.hangarSlotClass,
      laidOutClass: layoutClassFor(cls.hangarSlotClass),
    })
  }

  // Reconcile existing markers against the expected set: drop stale, keep
  // matching, leave the leftover expected set to spawn fresh.
  const occupiedSlotsByClass: Record<LaidOutSlotClass, Set<number>> = {
    capital: new Set(),
    smallCraft: new Set(),
  }
  const slotsByClass: Record<LaidOutSlotClass, MarkerSlot[]> = {
    capital: hangarMarkerSlots(hangarRect, 'capital'),
    smallCraft: hangarMarkerSlots(hangarRect, 'smallCraft'),
  }
  for (const markerEnt of world.query(ShipMarker, Position)) {
    const shipKey = markerEnt.get(ShipMarker)!.shipKey
    const target = expected.get(shipKey)
    if (!target) {
      markerEnt.destroy()
      continue
    }
    expected.delete(shipKey)
    const pos = markerEnt.get(Position)!
    const slots = slotsByClass[target.laidOutClass]
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].x === pos.x && slots[i].y === pos.y) {
        occupiedSlotsByClass[target.laidOutClass].add(i)
        break
      }
    }
  }

  if (expected.size === 0) return

  // Spawn fresh markers into the first available slot for each ship's
  // laid-out class. Hangar capacity is gated upstream (deriveHangarOccupancy)
  // so a class never exceeds its row count in practice; if it ever does,
  // drop the marker silently rather than crash.
  const cursorByClass: Record<LaidOutSlotClass, number> = { capital: 0, smallCraft: 0 }
  for (const [shipKey, info] of expected) {
    const slots = slotsByClass[info.laidOutClass]
    const occupied = occupiedSlotsByClass[info.laidOutClass]
    while (cursorByClass[info.laidOutClass] < slots.length
      && occupied.has(cursorByClass[info.laidOutClass])) {
      cursorByClass[info.laidOutClass]++
    }
    if (cursorByClass[info.laidOutClass] >= slots.length) continue
    const slotIndex = cursorByClass[info.laidOutClass]
    const slot = slots[slotIndex]
    occupied.add(slotIndex)
    cursorByClass[info.laidOutClass]++

    const cls = getShipClass(info.templateId)
    const templateId = markerTemplateId(info.slotClass, info.isFlagship)
    const kind = info.isFlagship ? 'boardShip' : 'inspectShip'
    world.spawn(
      Position({ x: slot.x, y: slot.y }),
      Interactable({ kind, label: cls.nameZh, fee: 0 }),
      ShipMarker({ shipKey }),
      EntityKey({ key: `shipmarker-${sceneId}-${shipKey}` }),
      TemplateRef({ id: templateId }),
    )
  }
}
