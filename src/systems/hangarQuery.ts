// Shared hangar lookup helpers. Used by fleetTransfer + shipDelivery, which
// would otherwise cyclically import each other for these tiny accessors.

import type { Entity } from 'koota'
import { Building, Hangar } from '../ecs/traits'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { poiIdForScene } from '../data/pois'

// First Hangar building at the given POI, or null when none. Hangar-per-POI
// is 1:1 today; if that ever changes the callers will need to specify which.
export function findHangarAtPoi(poiId: string): Entity | null {
  if (!poiId) return null
  for (const sceneId of SCENE_IDS) {
    if (poiIdForScene(sceneId) !== poiId) continue
    const w = getWorld(sceneId)
    for (const b of w.query(Building, Hangar)) return b
  }
  return null
}
