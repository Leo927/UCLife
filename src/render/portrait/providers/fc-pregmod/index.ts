// FC pregmod portrait provider — public face of the GPL-licensed subtree.
//
// This file is the ONLY entry point into `providers/fc-pregmod/` from
// outside the directory. Reached exclusively via `await import(...)` from
// `src/render/portrait/registry.ts` so the FC SVG/JS payload stays out of
// the main bundle until the user actually picks this provider.
//
// Importing this module registers `fcPregmodProvider` with the portrait
// registry as a side effect.

import type { Entity } from 'koota'
import type { PortraitProvider } from '../../types'
import { ensureLoaded, getApp } from './bridge'
import { loadRevampCache } from './cacheLoader'
import { characterToSlave } from './adapter/characterToSlave'
import type { SlaveLike } from './adapter/SlaveLike'

async function preload(): Promise<void> {
  await ensureLoaded()
  await loadRevampCache()
}

function renderFromSlave(slave: SlaveLike, displayClass?: string): DocumentFragment {
  const App = getApp()
  if (!App.Data.Art.VectorRevamp) {
    throw new Error('fc-pregmod renderFromSlave: revamp cache not loaded — call preload() first')
  }
  if (typeof App.Art.revampedVectorArtElement !== 'function') {
    throw new Error('fc-pregmod renderFromSlave: revampedVectorArtElement not installed — bridge.ensureLoaded() must run first')
  }
  return App.Art.revampedVectorArtElement(slave, displayClass)
}

export const fcPregmodProvider: PortraitProvider = {
  id: 'fc-pregmod',
  displayName: 'FC 矢量立绘',
  preload,
  render(entity: Entity): DocumentFragment {
    return renderFromSlave(characterToSlave(entity))
  },
}

// Exposed for the FC-specific PortraitTester dev surface, which renders
// from preset SlaveLike objects rather than going through the entity path.
export { renderFromSlave, preload as preloadFc }
export { makeBaseSlave } from './adapter/defaults'
export type { SlaveLike } from './adapter/SlaveLike'
