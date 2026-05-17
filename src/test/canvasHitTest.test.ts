// Canvas hit-test bridges world→screen for Pixi clicks. Exercises the
// projection math (rect.{left,top} + (world - cam)) against a real
// koota world + a stubbed document/canvas + the live cameraStore.
// jsdom isn't a project dep, so we mock document.querySelector inline.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getEntityScreenCoords } from './canvasHitTest'
import { getWorld, getActiveSceneId } from '../ecs/world'
import { EntityKey, Position } from '../ecs/traits'
import { useCamera } from '../render/cameraStore'

interface FakeCanvas {
  getBoundingClientRect(): { left: number; top: number; right: number; bottom: number }
}

let fakeCanvas: FakeCanvas | null = null

function installStubDocument(): void {
  ;(globalThis as unknown as { document: unknown }).document = {
    querySelector(sel: string): FakeCanvas | null {
      if (sel === '.game-canvas canvas') return fakeCanvas
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
