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

const sheetCache = new Map<string, Promise<HTMLCanvasElement>>()

function manifestKey(manifest: LpcManifest, animation: LpcAnimation): string {
  const layers = manifest.layers
    .map((l) => `${l.basePath}|${l.material ?? '_'}|${l.color ?? '_'}|${l.zPos}`)
    .join(';')
  return `${animation}::${manifest.bodyType}::${layers}`
}

/**
 * Build a single-animation spritesheet (832×256) for the given manifest.
 * Cached by manifest+animation, so repeated callers for the same character
 * share one composite.
 */
export function composeSheet(manifest: LpcManifest, animation: LpcAnimation): Promise<HTMLCanvasElement> {
  const key = manifestKey(manifest, animation)
  const hit = sheetCache.get(key)
  if (hit) return hit

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
    return canvas
  })()

  sheetCache.set(key, promise)
  promise.catch(() => sheetCache.delete(key))
  return promise
}

export function clearSheetCache(): void {
  sheetCache.clear()
  imgCache.clear()
}
