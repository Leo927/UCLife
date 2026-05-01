// FC's App.Art.SlaveArtElement(slave, ...) without the SugarCube macros and
// V.imageChoice switching. Callers pass an explicit renderer ID; the call is
// synchronous after the initial async cache load.

import type { RendererContext, RendererId } from '../types'
import { ensureLoaded, getApp, updateRendererContext } from '../bridge'
import { loadRevampCache, loadVectorCache } from '../infrastructure/cacheLoader'

export interface RenderOptions {
  renderer?: RendererId
  context?: Partial<RendererContext>
  /** Optional pre-allocated displayClass; FC generates one if omitted. */
  displayClass?: string
}

export async function preloadRenderer(renderer: RendererId): Promise<void> {
  await ensureLoaded()
  if (renderer === 'revamp') {
    await loadRevampCache()
  } else {
    await loadVectorCache()
  }
}

/**
 * Slave must conform to FC's HumanState shape — use adapter/characterToSlave
 * to derive one from a UC entity. Caller must `await preloadRenderer()`
 * once before invoking; throws if the cache hasn't loaded.
 */
export function renderPortrait(slave: unknown, opts: RenderOptions = {}): DocumentFragment {
  const renderer = opts.renderer ?? 'revamp'
  if (opts.context) updateRendererContext(opts.context)
  const App = getApp()
  if (renderer === 'revamp') {
    if (!App.Data.Art.VectorRevamp) {
      throw new Error('renderPortrait: revamp cache not loaded — call preloadRenderer("revamp") first')
    }
    return App.Art.revampedVectorArtElement!(slave, opts.displayClass)
  }
  if (!App.Data.Art.Vector) {
    throw new Error('renderPortrait: vector cache not loaded — call preloadRenderer("vector") first')
  }
  // Legacy vector renderer's SugarCube coupling is heavier than revamp's
  // and not yet wired through the bridge.
  throw new Error('renderPortrait: legacy "vector" renderer not yet available')
}
