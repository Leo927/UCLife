// World-space → screen-space bridge for Pixi canvas hit-tests.
// Test code uses this to feed `page.mouse.click(x, y)` for in-game
// entities — DOM UI uses `data-testid` selectors as today.
//
// Projection lives in src/render/Game.tsx + cameraStore.ts:
//   viewport.x = -camX (PixiGroundRenderer)
//   screen.x   = canvasRect.left + (world.x - camX)
// Same for y. The canvas element is the inner div.game-canvas's
// <canvas> child, located via document.querySelector at call time.

import { getWorld, getActiveSceneId } from '../ecs/world'
import { EntityKey, Position, IsPlayer, PoiTag, EnemyAI } from '../ecs/traits'
import { useCamera } from '../render/cameraStore'
import { testConfig } from './test-config'

export interface ScreenCoords {
  x: number
  y: number
}

function activeSceneEntityPos(entityId: string): { x: number; y: number } | null {
  const world = getWorld(getActiveSceneId())
  for (const e of world.query(EntityKey, Position)) {
    if (e.get(EntityKey)?.key !== entityId) continue
    const p = e.get(Position)
    return p ? { x: p.x, y: p.y } : null
  }
  return null
}

function groundCanvasRect(): DOMRect | null {
  const canvasEl = document.querySelector<HTMLCanvasElement>('.game-canvas canvas')
  return canvasEl ? canvasEl.getBoundingClientRect() : null
}

/**
 * Look up the active-scene entity whose EntityKey.key === entityId,
 * project its Position through the live camera + canvas rect, and
 * return viewport-relative screen coords. Returns null if:
 *
 *   - no entity with that key exists in the active scene
 *   - the entity has no Position trait
 *   - the canvas element is not mounted (page still booting)
 *   - the projected point falls outside the canvas rect
 */
export function getEntityScreenCoords(entityId: string): ScreenCoords | null {
  const foundEntity = activeSceneEntityPos(entityId)
  if (!foundEntity) return null

  const cam = useCamera.getState()
  const rect = groundCanvasRect()
  if (!rect) return null

  const screenX = rect.left + (foundEntity.x - cam.camX)
  const screenY = rect.top + (foundEntity.y - cam.camY)
  if (screenX < rect.left || screenX > rect.right) return null
  if (screenY < rect.top || screenY > rect.bottom) return null
  return { x: screenX, y: screenY }
}

/**
 * Like getEntityScreenCoords, but for an entity that projects OFF the
 * visible canvas it returns the projected point clamped to just inside the
 * canvas edge (by testConfig.walkClickMarginPx) — a valid click point in the
 * entity's direction. Journey smokes click-to-walk toward off-camera targets
 * in stages with this, re-reading each stage as the camera follows the player,
 * and switch to getEntityScreenCoords (true point, non-null) once the target
 * enters view to land the final talk/interact click on its sprite. Returns
 * null only when the entity is absent or the canvas isn't mounted.
 */
export function getEntityScreenCoordsClamped(entityId: string): ScreenCoords | null {
  const foundEntity = activeSceneEntityPos(entityId)
  if (!foundEntity) return null

  const cam = useCamera.getState()
  const rect = groundCanvasRect()
  if (!rect) return null

  const rawX = rect.left + (foundEntity.x - cam.camX)
  const rawY = rect.top + (foundEntity.y - cam.camY)
  const m = testConfig.walkClickMarginPx
  return {
    x: Math.max(rect.left + m, Math.min(rect.right - m, rawX)),
    y: Math.max(rect.top + m, Math.min(rect.bottom - m, rawY)),
  }
}

// ── Space-view (starmap) world→screen projection ───────────────────────
//
// The starmap (src/ui/SpaceView.tsx + src/render/space/PixiSpaceRenderer.ts)
// draws into its OWN Pixi viewport, not the ground cameraStore. With fit-mode
// off — the default, which journey tests never toggle (no `M` press) — the
// renderer keeps scale = 1 and centers the viewport on the player ship:
//
//   viewport.x = -shipX + viewW/2   (PixiSpaceRenderer.update, fitMode off)
//   screenX    = rect.left + (worldX - shipX) + viewW/2
//
// The space canvas is `.space-view canvas` (no class on the canvas itself;
// `.space-view` is a fixed inset:0 host). These helpers let a journey smoke
// click a POI or enemy on the starmap by real `page.mouse.click(x, y)`.
// They are READ-ONLY — the same coordinate-bridge role as
// getEntityScreenCoords, just for the space viewport.

function spaceShipWorldPos(): { x: number; y: number } | null {
  const ship = getWorld('spaceCampaign').queryFirst(IsPlayer, Position)
  return ship ? { ...ship.get(Position)! } : null
}

function projectSpaceWorldToScreen(world: { x: number; y: number }): ScreenCoords | null {
  const ship = spaceShipWorldPos()
  if (!ship) return null
  const canvasEl = document.querySelector<HTMLCanvasElement>('.space-view canvas')
  if (!canvasEl) return null
  const rect = canvasEl.getBoundingClientRect()
  const viewW = rect.right - rect.left
  const viewH = rect.bottom - rect.top
  const screenX = rect.left + (world.x - ship.x) + viewW / 2
  const screenY = rect.top + (world.y - ship.y) + viewH / 2
  if (screenX < rect.left || screenX > rect.right) return null
  if (screenY < rect.top || screenY > rect.bottom) return null
  return { x: screenX, y: screenY }
}

/**
 * Screen coords of a spaceCampaign POI (by poiId), projected through the live
 * starmap viewport. Returns null when the space view isn't mounted, the player
 * ship isn't in spaceCampaign, the POI is absent, or it projects off-canvas.
 */
export function getPoiScreenCoords(poiId: string): ScreenCoords | null {
  const space = getWorld('spaceCampaign')
  for (const e of space.query(PoiTag, Position)) {
    if (e.get(PoiTag)!.poiId === poiId) return projectSpaceWorldToScreen(e.get(Position)!)
  }
  return null
}

/**
 * Screen coords of a spaceCampaign enemy (by EntityKey, e.g.
 * `enemy-pirate-lunar-4`), projected through the live starmap viewport.
 * Returns null under the same conditions as getPoiScreenCoords.
 */
export function getEnemyScreenCoords(enemyKey: string): ScreenCoords | null {
  const space = getWorld('spaceCampaign')
  for (const e of space.query(EnemyAI, Position, EntityKey)) {
    if (e.get(EntityKey)!.key === enemyKey) return projectSpaceWorldToScreen(e.get(Position)!)
  }
  return null
}
