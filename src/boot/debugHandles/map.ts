// World-map + camera-region introspection. Lets the smoke suite assert that
// a hidden region (the orbital drydock folded into vonBraunCity) is absent
// from the player-facing map and excluded from the city camera bounds —
// without walking the React/Pixi tree.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { getWorld, SCENE_IDS } from '../../ecs/world'
import { Character, Health, IsPlayer, Position, Job } from '../../ecs/traits'
import { getPlacesInScene } from '../../data/worldMap'
import { isInHiddenRegion, cameraRegionAt } from '../../data/scenes'
import { worldConfig } from '../../config'

const TILE = worldConfig.tilePx

// All live scene ids — a tripwire that the former `vonBraunDrydock` scene
// world is gone (folded into vonBraunCity).
registerDebugHandle('sceneIds', (): string[] => [...SCENE_IDS])

// World-map place ids rendered for a scene (district + building markers).
// A hidden region's buildings are excluded by worldMap.ts, so the drydock's
// markers never appear here.
registerDebugHandle('worldMapPlaceIds', (sceneId: string): string[] =>
  getPlacesInScene(sceneId).map((p) => p.id),
)

// Whether a tile sits in a `hidden` camera region (off-map).
registerDebugHandle('isTileHidden', (sceneId: string, tile: { x: number; y: number }): boolean =>
  isInHiddenRegion(sceneId, tile.x, tile.y),
)

// The camera-clamp rect (tile-space) containing a tile, or null. Two tiles in
// different regions never share a clamp rect, so the city camera can't pan to
// the drydock and vice-versa.
registerDebugHandle('cameraRegionForTile', (
  sceneId: string, tile: { x: number; y: number },
): { x: number; y: number; w: number; h: number } | null =>
  cameraRegionAt(sceneId, tile.x, tile.y),
)

// Alive NPCs whose tile falls inside a region rect (tile-space), with job
// state. Used to assert the drydock crew exist in the vonBraunCity world and
// tick on its loop (acquire jobs) rather than being frozen off-map.
registerDebugHandle('npcsInRegion', (
  sceneId: string, rect: { x: number; y: number; w: number; h: number },
): Array<{ key: string; tile: { x: number; y: number }; hasJob: boolean }> => {
  const w = getWorld(sceneId)
  const out: Array<{ key: string; tile: { x: number; y: number }; hasJob: boolean }> = []
  for (const e of w.query(Character, Health, Position)) {
    if (e.has(IsPlayer) || e.get(Health)!.dead) continue
    const p = e.get(Position)!
    const tx = p.x / TILE, ty = p.y / TILE
    if (tx < rect.x || tx >= rect.x + rect.w || ty < rect.y || ty >= rect.y + rect.h) continue
    const job = e.get(Job)
    out.push({
      key: e.get(Character)!.name,
      tile: { x: Math.round(tx), y: Math.round(ty) },
      hasJob: !!job && job.workstation !== null,
    })
  }
  return out
})
