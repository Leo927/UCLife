// HTML wrapper around the FC SVG renderer. The first <Portrait/> mounted
// triggers asset cache preload; subsequent renders are Map-lookup speed.

import { useEffect, useReducer, useRef, useState } from 'react'
import type { Entity } from 'koota'
import { useWorld } from 'koota/react'
import { preloadRenderer, renderPortrait } from '../dispatcher/artDispatcher'
import { characterToSlave } from '../adapter/characterToSlave'
import type { SlaveLike } from '../adapter/SlaveLike'
import type { RendererId } from '../types'
import { Appearance } from '../../../ecs/traits'
import { useUI } from '../../../ui/uiStore'

interface PortraitProps {
  /** Provide either a slave object directly or a Character entity to derive one. */
  slave?: SlaveLike
  entity?: Entity
  renderer?: RendererId
  /** CSS width applied to the inner SVG container. Default 200px. */
  width?: number | string
  /** CSS height applied to the inner SVG container. Default 280px. */
  height?: number | string
  className?: string
  /** When false, suppresses the click-to-enlarge behavior. Default true when
   *  an entity is supplied; ignored when only a slave is provided. */
  clickable?: boolean
}

let preloadStarted = false
let preloadResolved = false
let preloadPromise: Promise<void> | null = null

function startPreload(renderer: RendererId): Promise<void> {
  if (!preloadStarted) {
    preloadStarted = true
    preloadPromise = preloadRenderer(renderer).then(
      () => {
        preloadResolved = true
      },
      (err) => {
        preloadStarted = false
        throw err
      },
    )
  }
  return preloadPromise!
}

export function Portrait({
  slave,
  entity,
  renderer = 'revamp',
  width = 200,
  height = 280,
  className,
  clickable = true,
}: PortraitProps): JSX.Element {
  const setEnlarged = useUI((s) => s.setEnlargedPortrait)
  const onClick = (entity && clickable) ? () => setEnlarged(entity) : undefined
  const cursor = onClick ? 'zoom-in' : undefined
  const containerRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(preloadResolved)
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
    if (preloadResolved) {
      setReady(true)
      return
    }
    let cancelled = false
    startPreload(renderer).then(
      () => {
        if (!cancelled) setReady(true)
      },
      (err) => {
        if (!cancelled) setError(err)
      },
    )
    return () => {
      cancelled = true
    }
  }, [renderer])

  useEffect(() => {
    const el = containerRef.current
    if (!el || !ready) return
    const slaveOrDerived = slave ?? (entity ? characterToSlave(entity) : null)
    if (!slaveOrDerived) return
    try {
      const fragment = renderPortrait(slaveOrDerived, { renderer })
      while (el.firstChild) el.removeChild(el.firstChild)
      el.appendChild(fragment)
    } catch (err) {
      setError(err as Error)
    }
  }, [slave, entity, renderer, ready, appearanceVersion])

  if (error) {
    return (
      <div className={className} style={{ width, height, color: '#a33', fontSize: 11 }}>
        Portrait error: {error.message}
      </div>
    )
  }
  if (!ready) {
    return (
      <div className={className} style={{ width, height, opacity: 0.5, fontSize: 11 }}>
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
