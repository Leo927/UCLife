// Asset registry — the single boundary between physical art files and
// the renderers. Pixi's `Assets` module owns the GPU texture cache;
// this module wraps it with the project's typed asset catalog so
// renderers ask `getArt('bed-flop')` rather than reaching for a path.
//
// Architecture:
//   - `art.json5` declares the catalog (`id → { path, w, h }`) and the
//     domain mappings that resolve game concepts to ids.
//   - At first access we install one Pixi bundle covering every
//     catalog entry. `preloadArt()` triggers an eager bundle load (call
//     it once during boot for the smoothest UX). Without preload, the
//     registry falls back to lazy `Assets.load()` per id — renderers
//     receive `texture: null` on the frame the asset first appears,
//     then the texture on subsequent frames once it lands.
//   - Pixel-art textures are forced to `nearest` scaleMode on load so
//     Pixi's default linear filter doesn't smear them.
//
// Renderers never call `Assets.load`, never read `assetConfig.path`,
// and never build per-domain texture caches. New asset categories just
// add a catalog entry + a domain mapping in JSON5.

import { Assets, Texture } from 'pixi.js'
import { artConfig } from '../../config'
import type { ArtId } from '../../config'

const BUNDLE_ID = 'uclife-art'
let bundleRegistered = false
const lazyRequested = new Set<ArtId>()

function ensureBundleRegistered(): void {
  if (bundleRegistered) return
  bundleRegistered = true
  const aliases: Record<string, string> = {}
  for (const [id, spec] of Object.entries(artConfig.catalog)) {
    aliases[id] = spec.path
  }
  Assets.addBundle(BUNDLE_ID, aliases)
}

function applyPixelArtFilter(tex: Texture): void {
  tex.source.scaleMode = 'nearest'
}

/** Block until every catalog entry is loaded. Idempotent. */
export async function preloadArt(): Promise<void> {
  ensureBundleRegistered()
  const textures = await Assets.loadBundle(BUNDLE_ID) as Record<ArtId, Texture>
  for (const tex of Object.values(textures)) applyPixelArtFilter(tex)
}

/**
 * Resolve a catalog id to its loaded texture, or `null` while a lazy
 * load is in flight (renderer should treat that as "draw nothing this
 * frame, try again next frame"). Returns `null` for unknown ids too.
 *
 * Render footprint (target world-pixel rectangle) is an object-
 * definition concern and lives in the caller's domain config, not on
 * the asset — Pixi will scale the texture to whatever (w, h) the
 * renderer sets on the sprite.
 */
export function getArt(id: ArtId): Texture | null {
  ensureBundleRegistered()
  if (!artConfig.catalog[id]) return null
  const cached = Assets.cache.get(id) as Texture | undefined
  if (cached) return cached
  if (!lazyRequested.has(id)) {
    lazyRequested.add(id)
    Assets.load<Texture>(id)
      .then(applyPixelArtFilter)
      .catch((e: unknown) => {
        lazyRequested.delete(id)
        // eslint-disable-next-line no-console
        console.warn(`[art] failed to load '${id}'`, e)
      })
  }
  return null
}
