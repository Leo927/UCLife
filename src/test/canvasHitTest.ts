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
import { EntityKey, Position, IsPlayer, PoiTag, EnemyAI, CombatShipState } from '../ecs/traits'
import { useCamera } from '../render/cameraStore'
import { testConfig } from './test-config'
import { ARENA_W, ARENA_H } from '../systems/combat'

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

function activeScenePlayerPos(): { x: number; y: number } | null {
  const p = getWorld(getActiveSceneId()).queryFirst(IsPlayer, Position)
  return p ? { ...p.get(Position)! } : null
}

/**
 * World-space (pixel) Position of an active-scene entity by EntityKey. Unlike
 * getEntityScreenCoords this is camera-independent and works for off-camera
 * entities — journey smokes use it to compute where to right-click the map
 * panel to route the player across the city (full pathfinding). Returns null
 * when no such entity exists in the active scene.
 */
export function getEntityWorldPos(entityId: string): { x: number; y: number } | null {
  return activeSceneEntityPos(entityId)
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
 * Like getEntityScreenCoords, but usable when the entity projects OFF the
 * visible canvas: it returns the point where the ray FROM THE PLAYER toward the
 * entity exits the canvas (inset by testConfig.walkClickMarginPx) — a valid
 * click point that preserves the true player→target direction (per-axis
 * clamping would distort the angle and steer the walk into obstacles). When the
 * entity is already on-canvas the true projected point is returned. Journey
 * smokes click-to-walk toward off-camera targets in stages with this, re-
 * reading as the camera follows the player, and switch to getEntityScreenCoords
 * once the target enters view for the final talk/interact click. Returns null
 * only when the entity/player is absent or the canvas isn't mounted.
 */
export function getEntityScreenCoordsClamped(entityId: string): ScreenCoords | null {
  const target = activeSceneEntityPos(entityId)
  if (!target) return null

  const cam = useCamera.getState()
  const rect = groundCanvasRect()
  if (!rect) return null

  const tx = rect.left + (target.x - cam.camX)
  const ty = rect.top + (target.y - cam.camY)
  if (tx >= rect.left && tx <= rect.right && ty >= rect.top && ty <= rect.bottom) {
    return { x: tx, y: ty } // on-canvas: true point
  }

  const player = activeScenePlayerPos()
  if (!player) return null
  const px = rect.left + (player.x - cam.camX)
  const py = rect.top + (player.y - cam.camY)
  const dx = tx - px
  const dy = ty - py
  const m = testConfig.walkClickMarginPx
  // Largest t in the target direction that stays inside the inset canvas.
  let t = 1
  if (dx > 0) t = Math.min(t, (rect.right - m - px) / dx)
  else if (dx < 0) t = Math.min(t, (rect.left + m - px) / dx)
  if (dy > 0) t = Math.min(t, (rect.bottom - m - py) / dy)
  else if (dy < 0) t = Math.min(t, (rect.top + m - py) / dy)
  t = Math.max(0, t)
  return { x: px + dx * t, y: py + dy * t }
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
  const w = spaceEnemyWorldPos(enemyKey)
  return w ? projectSpaceWorldToScreen(w) : null
}

function spaceEnemyWorldPos(enemyKey: string): { x: number; y: number } | null {
  const space = getWorld('spaceCampaign')
  for (const e of space.query(EnemyAI, Position, EntityKey)) {
    if (e.get(EntityKey)!.key === enemyKey) return { ...e.get(Position)! }
  }
  return null
}

/**
 * Like getEnemyScreenCoords, but for an enemy that projects OFF the space
 * canvas it returns the point where the ray from the ship (canvas centre)
 * toward the enemy exits the canvas — a valid right-click point to quick-
 * navigate TOWARD the enemy (raw-point course), closing the gap until it
 * enters view. Direction-preserving (per-axis clamp would distort the angle).
 */
function spacePoiWorldPos(poiId: string): { x: number; y: number } | null {
  const space = getWorld('spaceCampaign')
  for (const e of space.query(PoiTag, Position)) {
    if (e.get(PoiTag)!.poiId === poiId) return { ...e.get(Position)! }
  }
  return null
}

// Ray from the ship (space-canvas centre) toward a world target, clamped to the
// starmap canvas edge (sides by walkClickMarginPx; top/bottom by spaceClickInsetPx
// to clear the HUD). Direction-preserving; on-canvas targets return the true
// point. A valid right-click point to quick-navigate TOWARD the target, closing
// the gap until it enters view.
function spaceClampedTowardWorld(world: { x: number; y: number }): ScreenCoords | null {
  const ship = spaceShipWorldPos()
  if (!ship) return null
  const canvasEl = document.querySelector<HTMLCanvasElement>('.space-view canvas')
  if (!canvasEl) return null
  const rect = canvasEl.getBoundingClientRect()
  const cx = rect.left + (rect.right - rect.left) / 2
  const cy = rect.top + (rect.bottom - rect.top) / 2
  const tx = cx + (world.x - ship.x)
  const ty = cy + (world.y - ship.y)
  if (tx >= rect.left && tx <= rect.right && ty >= rect.top && ty <= rect.bottom) {
    return { x: tx, y: ty }
  }
  const dx = tx - cx
  const dy = ty - cy
  const m = testConfig.walkClickMarginPx
  const vm = testConfig.spaceClickInsetPx
  let t = 1
  if (dx > 0) t = Math.min(t, (rect.right - m - cx) / dx)
  else if (dx < 0) t = Math.min(t, (rect.left + m - cx) / dx)
  if (dy > 0) t = Math.min(t, (rect.bottom - vm - cy) / dy)
  else if (dy < 0) t = Math.min(t, (rect.top + vm - cy) / dy)
  t = Math.max(0, t)
  return { x: cx + dx * t, y: cy + dy * t }
}

export function getEnemyScreenCoordsClamped(enemyKey: string): ScreenCoords | null {
  const enemy = spaceEnemyWorldPos(enemyKey)
  return enemy ? spaceClampedTowardWorld(enemy) : null
}

/** POI analogue of getEnemyScreenCoordsClamped — hop home toward an off-canvas POI. */
export function getPoiScreenCoordsClamped(poiId: string): ScreenCoords | null {
  const poi = spacePoiWorldPos(poiId)
  return poi ? spaceClampedTowardWorld(poi) : null
}

// ── Tactical-combat arena world→screen projection ───────────────────────
//
// PixiTacticalRenderer (src/render/space/PixiTacticalRenderer.ts) letterbox-
// fits the fixed ARENA_W×ARENA_H arena into whatever viewport TacticalView
// gives it, centered, with the shorter screen-axis setting the scale
// (applyFit()). The renderer instance itself is a React-local ref with no
// global handle, but the fit is a pure function of the canvas's own
// bounding rect + the fixed arena size — recomputing it here (mirroring
// applyFit()/screenToWorld() exactly, including the `Math.round` on the
// offsets) needs no access to the live renderer.
const TACTICAL_SCENE_ID = 'playerShipInterior'

function tacticalCanvasRect(): DOMRect | null {
  const canvasEl = document.querySelector<HTMLCanvasElement>('.tactical-canvas-host canvas')
  return canvasEl ? canvasEl.getBoundingClientRect() : null
}

function tacticalWorldToScreen(world: { x: number; y: number }, rect: DOMRect): ScreenCoords {
  const viewW = rect.width
  const viewH = rect.height
  const scale = Math.min(viewW / ARENA_W, viewH / ARENA_H)
  const offX = Math.round((viewW - ARENA_W * scale) / 2)
  const offY = Math.round((viewH - ARENA_H * scale) / 2)
  return { x: rect.left + offX + world.x * scale, y: rect.top + offY + world.y * scale }
}

/**
 * Screen coords of an arbitrary tactical-arena world point (e.g. a rally
 * target), projected through the live tactical viewport. Returns null when
 * the tactical overlay isn't mounted.
 */
export function getTacticalWorldScreenCoords(world: { x: number; y: number }): ScreenCoords | null {
  const rect = tacticalCanvasRect()
  return rect ? tacticalWorldToScreen(world, rect) : null
}

/**
 * Screen coords of a tactical-arena CombatShipState entity (by EntityKey),
 * projected through the live tactical viewport. Returns null when the
 * overlay isn't mounted or no such entity exists in the ship-interior world.
 */
export function getTacticalEnemyScreenCoords(enemyKey: string): ScreenCoords | null {
  const w = getWorld(TACTICAL_SCENE_ID)
  for (const e of w.query(CombatShipState, EntityKey)) {
    if (e.get(EntityKey)!.key !== enemyKey) continue
    return getTacticalWorldScreenCoords(e.get(CombatShipState)!.pos)
  }
  return null
}
