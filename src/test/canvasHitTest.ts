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
import { EntityKey, Position } from '../ecs/traits'
import { useCamera } from '../render/cameraStore'

export interface ScreenCoords {
  x: number
  y: number
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
  const world = getWorld(getActiveSceneId())
  let foundEntity: { x: number; y: number } | null = null
  for (const e of world.query(EntityKey, Position)) {
    const k = e.get(EntityKey)
    if (k?.key !== entityId) continue
    const p = e.get(Position)
    if (!p) return null
    foundEntity = { x: p.x, y: p.y }
    break
  }
  if (!foundEntity) return null

  const cam = useCamera.getState()
  const canvasEl = document.querySelector<HTMLCanvasElement>('.game-canvas canvas')
  if (!canvasEl) return null
  const rect = canvasEl.getBoundingClientRect()

  const screenX = rect.left + (foundEntity.x - cam.camX)
  const screenY = rect.top + (foundEntity.y - cam.camY)
  if (screenX < rect.left || screenX > rect.right) return null
  if (screenY < rect.top || screenY > rect.bottom) return null
  return { x: screenX, y: screenY }
}
