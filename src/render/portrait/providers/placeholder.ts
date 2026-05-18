// Built-in zero-asset portrait provider. Renders a flat silhouette tinted
// by Appearance.skin/hColor plus the character's first-letter initial.
// Always available; no GPL dependency; used by the test boot path and as
// a low-bandwidth fallback.

import type { Entity } from 'koota'
import json5 from 'json5'
import type { PortraitProvider } from '../types'
import { Appearance, Character } from '../../../ecs/traits'
import raw from './placeholder.json5?raw'

interface PlaceholderConfig {
  viewBox: { w: number; h: number }
  body: { cx: number; cy: number; rx: number; ry: number }
  head: { cx: number; cy: number; r: number }
  hair: { cx: number; cy: number; rx: number; ry: number }
  initial: { x: number; y: number; fontSize: number; fill: string }
  skinColors: Record<string, string>
  skinFallback: string
  hairFallback: string
  background: string
}

const placeholderConfig = json5.parse(raw) as PlaceholderConfig

const SVG_NS = 'http://www.w3.org/2000/svg'

function pickSkinColor(skin: string | undefined): string {
  if (!skin) return placeholderConfig.skinFallback
  return (placeholderConfig.skinColors as Record<string, string>)[skin]
    ?? placeholderConfig.skinFallback
}

function pickHairColor(hColor: string | undefined): string {
  if (!hColor) return placeholderConfig.hairFallback
  return hColor
}

function initialOf(name: string | undefined): string {
  if (!name) return '?'
  const trimmed = name.trim()
  if (!trimmed) return '?'
  return trimmed.charAt(0).toUpperCase()
}

function buildSilhouette(entity: Entity): SVGSVGElement {
  const ap = entity.get(Appearance)
  const ch = entity.get(Character)
  const { viewBox, body, head, hair, initial, background } = placeholderConfig

  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('xmlns', SVG_NS)
  svg.setAttribute('width', '100%')
  svg.setAttribute('height', '100%')
  svg.setAttribute('viewBox', `0 0 ${viewBox.w} ${viewBox.h}`)
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')

  const bg = document.createElementNS(SVG_NS, 'rect')
  bg.setAttribute('x', '0')
  bg.setAttribute('y', '0')
  bg.setAttribute('width', String(viewBox.w))
  bg.setAttribute('height', String(viewBox.h))
  bg.setAttribute('fill', background)
  svg.appendChild(bg)

  const skinColor = pickSkinColor(ap?.skin)
  const hairColor = pickHairColor(ap?.hColor)

  const bodyEl = document.createElementNS(SVG_NS, 'ellipse')
  bodyEl.setAttribute('cx', String(body.cx))
  bodyEl.setAttribute('cy', String(body.cy))
  bodyEl.setAttribute('rx', String(body.rx))
  bodyEl.setAttribute('ry', String(body.ry))
  bodyEl.setAttribute('fill', skinColor)
  svg.appendChild(bodyEl)

  const headEl = document.createElementNS(SVG_NS, 'circle')
  headEl.setAttribute('cx', String(head.cx))
  headEl.setAttribute('cy', String(head.cy))
  headEl.setAttribute('r', String(head.r))
  headEl.setAttribute('fill', skinColor)
  svg.appendChild(headEl)

  const hairEl = document.createElementNS(SVG_NS, 'ellipse')
  hairEl.setAttribute('cx', String(hair.cx))
  hairEl.setAttribute('cy', String(hair.cy))
  hairEl.setAttribute('rx', String(hair.rx))
  hairEl.setAttribute('ry', String(hair.ry))
  hairEl.setAttribute('fill', hairColor)
  svg.appendChild(hairEl)

  const textEl = document.createElementNS(SVG_NS, 'text')
  textEl.setAttribute('x', String(initial.x))
  textEl.setAttribute('y', String(initial.y))
  textEl.setAttribute('text-anchor', 'middle')
  textEl.setAttribute('font-size', String(initial.fontSize))
  textEl.setAttribute('fill', initial.fill)
  textEl.setAttribute('font-family', 'sans-serif')
  textEl.textContent = initialOf(ch?.name)
  svg.appendChild(textEl)

  return svg
}

export const placeholderProvider: PortraitProvider = {
  id: 'placeholder',
  displayName: '占位轮廓 (低带宽)',
  async preload(): Promise<void> {
    // No assets to load. Resolved immediately for parity with FC provider's contract.
  },
  render(entity: Entity): SVGSVGElement {
    return buildSilhouette(entity)
  },
}
