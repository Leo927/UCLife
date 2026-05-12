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
import { worldConfig } from '../config'

const TILE = worldConfig.tilePx
const SHIP_SCENE_ID = 'playerShipInterior'

interface MarkerSlot {
  x: number
  y: number
}

// Lay out a row of ship-parking slots across the top portion of the
// hangar building's footprint. Two rows so a fully-stocked drydock
// (4 capital + 12 smallCraft = 16 hulls max) still fits visually
// without spilling onto workstations/beds.
function hangarMarkerSlots(building: { x: number; y: number; w: number; h: number }): MarkerSlot[] {
  const slots: MarkerSlot[] = []
  const cols = Math.max(2, Math.floor((building.w / TILE - 4) / 2))
  const rowYs = [
    building.y + 4 * TILE,
    building.y + 7 * TILE,
  ]
  const startX = building.x + 3 * TILE
  for (const y of rowYs) {
    for (let c = 0; c < cols; c++) {
      slots.push({ x: startX + c * TILE * 2, y })
    }
  }
  return slots
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

  // Build the set of ship keys that should be markered in this scene.
  const expected = new Map<string, { ent: Entity; isFlagship: boolean; templateId: string }>()
  for (const shipEnt of shipWorld.query(Ship, EntityKey)) {
    const s = shipEnt.get(Ship)!
    if (s.dockedAtPoiId !== poiId) continue
    const key = shipEnt.get(EntityKey)!.key
    expected.set(key, {
      ent: shipEnt,
      isFlagship: shipEnt.has(IsFlagshipMark),
      templateId: s.templateId,
    })
  }

  // Reconcile existing markers against the expected set: drop stale, keep
  // matching, leave the leftover expected set to spawn fresh.
  const occupiedSlots = new Set<number>()
  for (const markerEnt of world.query(ShipMarker, Position)) {
    const shipKey = markerEnt.get(ShipMarker)!.shipKey
    const target = expected.get(shipKey)
    if (!target) {
      markerEnt.destroy()
      continue
    }
    expected.delete(shipKey)
    // Track which slot this marker occupies so a new spawn doesn't collide.
    const pos = markerEnt.get(Position)!
    const slots = hangarMarkerSlots(hangarRect)
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].x === pos.x && slots[i].y === pos.y) {
        occupiedSlots.add(i)
        break
      }
    }
  }

  if (expected.size === 0) return

  // Spawn fresh markers into the first available slot for each.
  const slots = hangarMarkerSlots(hangarRect)
  let cursor = 0
  for (const [shipKey, info] of expected) {
    while (cursor < slots.length && occupiedSlots.has(cursor)) cursor++
    if (cursor >= slots.length) break  // hangar slot count exceeded — drop silently
    const slot = slots[cursor]
    occupiedSlots.add(cursor)

    const cls = getShipClass(info.templateId)
    const templateId = info.isFlagship ? 'docked-flagship-marker' : 'docked-ship-marker'
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
