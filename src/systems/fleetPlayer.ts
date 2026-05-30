// Shared player-entity lookup for the fleet systems. The player body
// migrates between scene worlds (ground city ↔ ship interior ↔ space), so
// the canonical lookup scans every scene world for the IsPlayer marker.
// Factored here so multiple fleet systems share one finder without a
// systems↔systems import cycle.

import type { Entity } from 'koota'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { IsPlayer } from '../ecs/traits'

export function findPlayerEntity(): Entity | null {
  for (const sceneId of SCENE_IDS) {
    const p = getWorld(sceneId).queryFirst(IsPlayer)
    if (p) return p
  }
  return null
}
