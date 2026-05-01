// CPU port of Universal-LPC-Spritesheet-Character-Generator/sources/canvas/
// palette-recolor.js (the recolorImageCPU path). The upstream WebGL path is
// omitted — composited sheets are cached per appearance, so the per-pixel
// cost is paid once per character.

import { getPalette, getSourcePalette } from './palettes'

interface Rgb { r: number; g: number; b: number }

interface ColorPair { source: Rgb; target: Rgb }

function hexToRgb(hex: string): Rgb {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!m) throw new Error(`recolor: invalid hex color "${hex}"`)
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  }
}

function buildPairs(source: readonly string[], target: readonly string[]): ColorPair[] {
  const out: ColorPair[] = []
  for (let i = 0; i < source.length && i < target.length; i++) {
    out.push({ source: hexToRgb(source[i]), target: hexToRgb(target[i]) })
  }
  return out
}

// Tolerance of 1 per channel matches the upstream WebGL shader threshold
// (0.004 * 255 ≈ 1).
export function recolor(
  source: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  material: 'body' | 'hair',
  target: string,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('recolor: 2D context unavailable')
  ctx.drawImage(source as CanvasImageSource, 0, 0)

  const pairs = buildPairs(getSourcePalette(material), getPalette(material, target))
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const px = data.data

  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue
    const r = px[i], g = px[i + 1], b = px[i + 2]
    for (const pair of pairs) {
      if (
        Math.abs(r - pair.source.r) <= 1 &&
        Math.abs(g - pair.source.g) <= 1 &&
        Math.abs(b - pair.source.b) <= 1
      ) {
        px[i] = pair.target.r
        px[i + 1] = pair.target.g
        px[i + 2] = pair.target.b
        break
      }
    }
  }

  ctx.putImageData(data, 0, 0)
  return canvas
}
