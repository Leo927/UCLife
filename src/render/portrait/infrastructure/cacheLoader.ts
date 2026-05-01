// Replaces FC's App.Art.cacheArtData() (artInfrastructure.js:13–35), which
// read base64-encoded SVG passages from a Twine document. UC reads sprite
// maps from JSON emitted by scripts/buildPortraitCache.ts, lazy-imported.

import type { SvgCache } from '../types'
import { ensureLoaded, installFCGlobals } from '../bridge'

let revampPromise: Promise<SvgCache> | null = null
let vectorPromise: Promise<SvgCache> | null = null

function parseCache(json: Record<string, string>): SvgCache {
  const map: SvgCache = new Map()
  for (const [name, body] of Object.entries(json)) {
    const div = document.createElement('div')
    div.innerHTML = body.trim()
    const child = div.children.item(0)
    if (child) {
      map.set(name, child)
    } else {
      console.warn(`[portrait-cache] skipping malformed SVG: ${name}`)
    }
  }
  return map
}

export function loadRevampCache(): Promise<SvgCache> {
  if (revampPromise) return revampPromise
  revampPromise = (async () => {
    installFCGlobals()
    await ensureLoaded()
    const mod = await import('../assets/cache/vector_revamp.cache.json')
    const cache = parseCache(mod.default as Record<string, string>)
    globalThis.App.Data.Art.VectorRevamp = cache
    return cache
  })()
  return revampPromise
}

export function loadVectorCache(): Promise<SvgCache> {
  if (vectorPromise) return vectorPromise
  vectorPromise = (async () => {
    installFCGlobals()
    await ensureLoaded()
    const mod = await import('../assets/cache/vector.cache.json')
    const cache = parseCache(mod.default as Record<string, string>)
    globalThis.App.Data.Art.Vector = cache
    return cache
  })()
  return vectorPromise
}
