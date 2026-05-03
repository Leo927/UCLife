import type { LpcAnimation, LpcLayer, LpcManifest } from './types'
import { recolor } from './recolor'

// LPC standard sheet: 64×64 frames, 13 cols × 4 rows (up/left/down/right).
export const FRAME_SIZE = 64
export const FRAMES_PER_ROW = 13
export const SHEET_WIDTH = FRAME_SIZE * FRAMES_PER_ROW
export const SHEET_HEIGHT = FRAME_SIZE * 4

function lpcBaseUrl(): string {
  const env = (import.meta as unknown as { env?: { VITE_LPC_BASE_URL?: string } }).env
  return env?.VITE_LPC_BASE_URL ?? '/lpc'
}

const imgCache = new Map<string, Promise<HTMLImageElement>>()

function loadImage(url: string): Promise<HTMLImageElement> {
  const hit = imgCache.get(url)
  if (hit) return hit
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`compose: failed to load ${url}`))
    img.src = url
  })
  imgCache.set(url, p)
  p.catch(() => imgCache.delete(url))
  return p
}

async function renderLayer(layer: LpcLayer, animation: LpcAnimation): Promise<HTMLCanvasElement | HTMLImageElement> {
  const url = `${lpcBaseUrl()}/${layer.basePath}/${animation}.png`
  const img = await loadImage(url)
  if (layer.material === null || layer.color === null) return img
  return recolor(img, layer.material, layer.color)
}

// LRU-bounded — appearance space is small in practice (sex × skin × hair) but
// procgen + special characters can drift past defaults. Each entry is one
// 832×256 RGBA canvas ≈ 832KB; 64 entries ≈ 53MB worst case.
const SHEET_CACHE_MAX = 64
const sheetCache = new Map<string, Promise<HTMLCanvasElement>>()

function manifestKey(manifest: LpcManifest, animation: LpcAnimation): string {
  const layers = manifest.layers
    .map((l) => `${l.basePath}|${l.material ?? '_'}|${l.color ?? '_'}|${l.zPos}`)
    .join(';')
  return `${animation}::${manifest.bodyType}::${layers}`
}

// Profiling: caller flips `spriteStats.enabled = true` to start collecting.
// Pattern matches `hpaStats` in src/systems/hpa.ts. Counters are O(1) so this
// is safe to leave on for the duration of a perf trace.
export const spriteStats = {
  enabled: false,
  hits: 0,
  misses: 0,
  totalMissMs: 0,
  evictions: 0,
}

export function resetSpriteStats(): void {
  spriteStats.hits = 0
  spriteStats.misses = 0
  spriteStats.totalMissMs = 0
  spriteStats.evictions = 0
}

export function getSpriteCacheSize(): { size: number; max: number } {
  return { size: sheetCache.size, max: SHEET_CACHE_MAX }
}

/**
 * Build a single-animation spritesheet (832×256) for the given manifest.
 * Cached by manifest+animation, so repeated callers for the same character
 * share one composite. LRU-bounded at SHEET_CACHE_MAX entries.
 */
export function composeSheet(manifest: LpcManifest, animation: LpcAnimation): Promise<HTMLCanvasElement> {
  const key = manifestKey(manifest, animation)
  const hit = sheetCache.get(key)
  if (hit) {
    // LRU: re-insert moves to most-recent end of Map iteration order.
    sheetCache.delete(key)
    sheetCache.set(key, hit)
    if (spriteStats.enabled) spriteStats.hits++
    return hit
  }

  const PROF = spriteStats.enabled
  const startMs = PROF ? performance.now() : 0
  const promise = (async () => {
    // zPos ascending — body first, hair on top.
    const ordered = [...manifest.layers].sort((a, b) => a.zPos - b.zPos)
    const rendered = await Promise.all(ordered.map((l) => renderLayer(l, animation)))

    const canvas = document.createElement('canvas')
    canvas.width = SHEET_WIDTH
    canvas.height = SHEET_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('compose: 2D context unavailable')
    ctx.imageSmoothingEnabled = false
    for (const layer of rendered) {
      ctx.drawImage(layer as CanvasImageSource, 0, 0)
    }
    if (PROF) {
      spriteStats.misses++
      spriteStats.totalMissMs += performance.now() - startMs
    }
    return canvas
  })()

  sheetCache.set(key, promise)
  promise.catch(() => sheetCache.delete(key))

  // LRU eviction — Map keeps insertion order, so the first key is the oldest.
  if (sheetCache.size > SHEET_CACHE_MAX) {
    const oldest = sheetCache.keys().next().value
    if (oldest !== undefined) {
      sheetCache.delete(oldest)
      if (PROF) spriteStats.evictions++
    }
  }

  return promise
}

export function clearSheetCache(): void {
  sheetCache.clear()
  imgCache.clear()
  resetSpriteStats()
}
