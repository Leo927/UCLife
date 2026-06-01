// Shared hangar lookup helpers. Used by fleetTransfer + shipDelivery, which
// would otherwise cyclically import each other for these tiny accessors.

import type { Entity } from 'koota'
import { Building, Hangar } from '../ecs/traits'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { poiIdForHangar } from '../data/pois'

// First Hangar building at the given POI, or null when none. Each POI still
// maps to a single hangar; the surface yard and the orbital drydock are
// distinct POIs even though they now share the vonBraunCity world.
export function findHangarAtPoi(poiId: string): Entity | null {
  if (!poiId) return null
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const b of w.query(Building, Hangar)) {
      if (poiIdForHangar(sceneId, b.get(Building)!) === poiId) return b
    }
  }
  return null
}
