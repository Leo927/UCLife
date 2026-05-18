// Provider-agnostic portrait surface. Reads the active provider from
// the prefs store and routes render through the registry. The FC pregmod
// chunk is dynamic-imported by the registry the first time it's selected;
// the placeholder provider is statically registered and always available.

import { useEffect, useReducer, useRef, useState } from 'react'
import type { Entity } from 'koota'
import { useWorld } from 'koota/react'
import json5 from 'json5'
import { resolveActivePortraitProvider } from '../registry'
import { usePortraitPrefs } from '../prefs'
import type { PortraitProvider } from '../types'
import { Appearance } from '../../../ecs/traits'
import { useUI } from '../../../ui/uiStore'
import portraitRaw from '../portrait.json5?raw'

interface PortraitUiConfig {
  defaultWidth: number
  defaultHeight: number
  loadingFontSize: number
  loadingOpacity: number
  errorFontSize: number
}
const portraitUi = json5.parse(portraitRaw) as PortraitUiConfig

interface PortraitProps {
  entity?: Entity
  /** CSS width applied to the inner SVG container. */
  width?: number | string
  /** CSS height applied to the inner SVG container. */
  height?: number | string
  className?: string
  /** When false, suppresses the click-to-enlarge behavior. Default true. */
  clickable?: boolean
}

// Per-provider preload cache. The first mount that lands on a given provider
// triggers `provider.preload()`; later mounts await the same promise.
const preloadByProvider = new Map<string, Promise<void>>()

function startPreload(provider: PortraitProvider): Promise<void> {
  const existing = preloadByProvider.get(provider.id)
  if (existing) return existing
  const p = provider.preload().catch((err) => {
    preloadByProvider.delete(provider.id)
    throw err
  })
  preloadByProvider.set(provider.id, p)
  return p
}

export function Portrait({
  entity,
  width = portraitUi.defaultWidth,
  height = portraitUi.defaultHeight,
  className,
  clickable = true,
}: PortraitProps): JSX.Element {
  const providerId = usePortraitPrefs((s) => s.portraitProvider)
  const setEnlarged = useUI((s) => s.setEnlargedPortrait)
  const onClick = (entity && clickable) ? () => setEnlarged(entity) : undefined
  const cursor = onClick ? 'zoom-in' : undefined
  const containerRef = useRef<HTMLDivElement>(null)
  const providerRef = useRef<PortraitProvider | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  // useReducer rather than useTrait so React state-bailout can't skip a
  // re-render when a new Appearance happens to shallow-match the previous.
  const world = useWorld()
  const [appearanceVersion, bumpAppearance] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    if (!entity) return
    return world.onChange(Appearance, (e) => {
      if (e === entity) bumpAppearance()
    })
  }, [entity, world])

  useEffect(() => {
    let cancelled = false
    // Clear the ref before awaiting so the render effect can't paint with
    // the previous provider during the gap between providerId change and
    // setReady(true) — happens when the new provider's preload resolves in
    // a microtask before React has flushed the setReady(false) commit.
    providerRef.current = null
    setReady(false)
    setError(null)
    ;(async () => {
      try {
        const provider = await resolveActivePortraitProvider()
        await startPreload(provider)
        if (cancelled) return
        providerRef.current = provider
        setReady(true)
      } catch (err) {
        if (!cancelled) setError(err as Error)
      }
    })()
    return () => { cancelled = true }
  }, [providerId])

  useEffect(() => {
    const el = containerRef.current
    const provider = providerRef.current
    if (!el || !ready || !provider || !entity) return
    try {
      const out = provider.render(entity)
      while (el.firstChild) el.removeChild(el.firstChild)
      el.appendChild(out)
    } catch (err) {
      setError(err as Error)
    }
  }, [entity, ready, providerId, appearanceVersion])

  if (error) {
    return (
      <div className={className} style={{ width, height, color: '#a33', fontSize: portraitUi.errorFontSize }}>
        Portrait error: {error.message}
      </div>
    )
  }
  if (!ready) {
    return (
      <div className={className} style={{ width, height, opacity: portraitUi.loadingOpacity, fontSize: portraitUi.loadingFontSize }}>
        加载头像…
      </div>
    )
  }
  // position: relative is load-bearing — FC emits per-layer CSS `.artN
  // { position: absolute; height: 100%; ... }`, so without a positioned
  // ancestor the SVGs sample the document height and blow past the box.
  return (
    <div
      ref={containerRef}
      className={className}
      onClick={onClick}
      style={{ width, height, overflow: 'hidden', position: 'relative', cursor }}
    />
  )
}
