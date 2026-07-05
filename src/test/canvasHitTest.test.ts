// Canvas hit-test bridges world→screen for Pixi clicks. Exercises the
// projection math (rect.{left,top} + (world - cam)) against a real
// koota world + a stubbed document/canvas + the live cameraStore.
// jsdom isn't a project dep, so we mock document.querySelector inline.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  getEntityScreenCoords, getEntityScreenCoordsClamped,
  getPoiScreenCoords, getEnemyScreenCoords,
} from './canvasHitTest'
import { getWorld, getActiveSceneId } from '../ecs/world'
import { EntityKey, Position, IsPlayer, PoiTag, EnemyAI } from '../ecs/traits'
import { useCamera } from '../render/cameraStore'

interface FakeCanvas {
  getBoundingClientRect(): { left: number; top: number; right: number; bottom: number }
}

let fakeCanvas: FakeCanvas | null = null
let fakeSpaceCanvas: FakeCanvas | null = null

function installStubDocument(): void {
  ;(globalThis as unknown as { document: unknown }).document = {
    querySelector(sel: string): FakeCanvas | null {
      if (sel === '.game-canvas canvas') return fakeCanvas
      if (sel === '.space-view canvas') return fakeSpaceCanvas
      return null
    },
  }
}

function uninstallStubDocument(): void {
  delete (globalThis as unknown as { document?: unknown }).document
}

describe('getEntityScreenCoords', () => {
  beforeEach(() => {
    installStubDocument()
    fakeCanvas = {
      getBoundingClientRect: () => ({ left: 100, top: 50, right: 900, bottom: 650 }),
    }
  })

  afterEach(() => {
    fakeCanvas = null
    uninstallStubDocument()
    useCamera.getState().setCamera({ canvasW: 0, canvasH: 0, camX: 0, camY: 0 })
    const world = getWorld(getActiveSceneId())
    for (const e of world.query(EntityKey)) e.destroy()
  })

  it('returns canvasRect-offset world coords when camera is at origin', () => {
    const world = getWorld(getActiveSceneId())
    world.spawn(EntityKey({ key: 'fixture-a' }), Position({ x: 200, y: 150 }))
    useCamera.getState().setCamera({ canvasW: 800, canvasH: 600, camX: 0, camY: 0 })
    // 100 (rect.left) + 200 (world.x - 0) = 300; 50 + 150 = 200.
    expect(getEntityScreenCoords('fixture-a')).toEqual({ x: 300, y: 200 })
  })

  it('subtracts camera offset from world coords', () => {
    const world = getWorld(getActiveSceneId())
    world.spawn(EntityKey({ key: 'fixture-b' }), Position({ x: 500, y: 400 }))
    useCamera.getState().setCamera({ canvasW: 800, canvasH: 600, camX: 100, camY: 80 })
    // 100 + (500 - 100) = 500; 50 + (400 - 80) = 370.
    expect(getEntityScreenCoords('fixture-b')).toEqual({ x: 500, y: 370 })
  })

  it('returns null for unknown entity id', () => {
    expect(getEntityScreenCoords('does-not-exist')).toBeNull()
  })

  it('returns null when projected point falls outside canvas rect', () => {
    const world = getWorld(getActiveSceneId())
    // x=10_000 with cam=0 → screen.x = 100 + 10_000 = 10_100, past rect.right=900.
    world.spawn(EntityKey({ key: 'fixture-far' }), Position({ x: 10_000, y: 150 }))
    useCamera.getState().setCamera({ canvasW: 800, canvasH: 600, camX: 0, camY: 0 })
    expect(getEntityScreenCoords('fixture-far')).toBeNull()
  })

  it('returns null when canvas is not mounted', () => {
    fakeCanvas = null
    const world = getWorld(getActiveSceneId())
    world.spawn(EntityKey({ key: 'fixture-c' }), Position({ x: 200, y: 150 }))
    expect(getEntityScreenCoords('fixture-c')).toBeNull()
  })
})

describe('getEntityScreenCoordsClamped', () => {
  beforeEach(() => {
    installStubDocument()
    fakeCanvas = {
      getBoundingClientRect: () => ({ left: 100, top: 50, right: 900, bottom: 650 }),
    }
  })

  afterEach(() => {
    fakeCanvas = null
    uninstallStubDocument()
    useCamera.getState().setCamera({ canvasW: 0, canvasH: 0, camX: 0, camY: 0 })
    const world = getWorld(getActiveSceneId())
    for (const e of world.query(EntityKey)) e.destroy()
  })

  it('returns the true on-screen point when the entity is inside the canvas', () => {
    const world = getWorld(getActiveSceneId())
    world.spawn(EntityKey({ key: 'near' }), Position({ x: 200, y: 150 }))
    useCamera.getState().setCamera({ canvasW: 800, canvasH: 600, camX: 0, camY: 0 })
    // Same projection as getEntityScreenCoords, inside the rect → unclamped.
    expect(getEntityScreenCoordsClamped('near')).toEqual({ x: 300, y: 200 })
  })

  it('clamps an off-canvas target to just inside the edge (margin=8)', () => {
    const world = getWorld(getActiveSceneId())
    // rawX = 100 + 10_000 = 10_100 → clamp to right(900) - margin(8) = 892.
    // rawY = 50 + 150 = 200 → inside [58, 642] → unchanged.
    world.spawn(EntityKey({ key: 'far' }), Position({ x: 10_000, y: 150 }))
    useCamera.getState().setCamera({ canvasW: 800, canvasH: 600, camX: 0, camY: 0 })
    expect(getEntityScreenCoordsClamped('far')).toEqual({ x: 892, y: 200 })
  })

  it('returns null for an unknown entity id', () => {
    expect(getEntityScreenCoordsClamped('nope')).toBeNull()
  })
})

describe('space-view screen coords (getPoiScreenCoords / getEnemyScreenCoords)', () => {
  // scale = 1, viewport centered on the player ship:
  //   screenX = rect.left + (worldX - shipX) + viewW/2
  const SPACE = 'spaceCampaign'

  beforeEach(() => {
    installStubDocument()
    fakeSpaceCanvas = {
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 1280, bottom: 800 }),
    }
    getWorld(SPACE).spawn(IsPlayer, Position({ x: 500, y: 400 }))
  })

  afterEach(() => {
    fakeSpaceCanvas = null
    uninstallStubDocument()
    const world = getWorld(SPACE)
    for (const e of world.query(Position)) e.destroy()
  })

  it('projects a POI world position through the ship-centered viewport', () => {
    getWorld(SPACE).spawn(PoiTag({ poiId: 'vonBraun' }), Position({ x: 600, y: 400 }))
    // (600-500)+640 = 740; (400-400)+400 = 400.
    expect(getPoiScreenCoords('vonBraun')).toEqual({ x: 740, y: 400 })
  })

  it('projects an enemy world position by EntityKey', () => {
    getWorld(SPACE).spawn(
      EnemyAI(), EntityKey({ key: 'enemy-pirate-lunar-4' }), Position({ x: 500, y: 300 }),
    )
    // (500-500)+640 = 640; (300-400)+400 = 300.
    expect(getEnemyScreenCoords('enemy-pirate-lunar-4')).toEqual({ x: 640, y: 300 })
  })

  it('returns null for an absent POI / enemy', () => {
    expect(getPoiScreenCoords('nope')).toBeNull()
    expect(getEnemyScreenCoords('nope')).toBeNull()
  })

  it('returns null when the space canvas is not mounted', () => {
    fakeSpaceCanvas = null
    getWorld(SPACE).spawn(PoiTag({ poiId: 'vonBraun' }), Position({ x: 600, y: 400 }))
    expect(getPoiScreenCoords('vonBraun')).toBeNull()
  })
})
