import { createWorld, type World } from 'koota'
import { scenes, sceneIds, initialSceneId, getSceneConfig } from '../data/scenes'

export type SceneId = string

export const SCENE_IDS: readonly SceneId[] = sceneIds

const worlds = new Map<SceneId, World>()
for (const id of sceneIds) worlds.set(id, createWorld())

let activeId: SceneId = initialSceneId

export function getWorld(id: SceneId): World {
  const w = worlds.get(id)
  if (!w) throw new Error(`Unknown scene: ${id}`)
  return w
}

export function getActiveSceneId(): SceneId {
  return activeId
}

// Most callers should go through sim/scene.ts so the React layer re-renders
// on the change; this raw setter exists for non-React callsites (flight
// midpoint, save/load).
export function setActiveSceneId(id: SceneId): void {
  if (!worlds.has(id)) throw new Error(`Unknown scene: ${id}`)
  activeId = id
}

export function getSceneTitle(id: SceneId): string {
  return getSceneConfig(id).titleZh
}

export function getSceneDimensions(id: SceneId): { tilesX: number; tilesY: number } {
  const c = getSceneConfig(id)
  return { tilesX: c.tilesX, tilesY: c.tilesY }
}

export function getActiveSceneDimensions(): { tilesX: number; tilesY: number } {
  return getSceneDimensions(activeId)
}

export { scenes }

// Methods are bound to the real World instance so koota's private class
// fields (#id, #isInitialized) keep resolving correctly. A naked Proxy
// without bind would set `this` = the Proxy and break private-field access
// during reset() / id getters.
export const world: World = new Proxy({} as World, {
  get(_t, prop) {
    const actual = getWorld(activeId) as unknown as Record<string | symbol, unknown>
    const v = actual[prop]
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(actual) : v
  },
  has(_t, prop) {
    const actual = getWorld(activeId) as unknown as Record<string | symbol, unknown>
    return prop in actual
  },
}) as World

if (typeof window !== 'undefined' && (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
  ;(window as unknown as { uclifeWorld: unknown }).uclifeWorld = world
}
