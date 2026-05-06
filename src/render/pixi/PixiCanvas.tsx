// Phase 1 of the Konva → Pixi migration. Minimal React shim that owns a
// Pixi Application via raw useEffect — no @pixi/react. The renderer is
// driven imperatively from outside (the onReady callback gets the
// Application instance once it's initialized).
//
// Pixi v8 split construction from init: `new Application()` then
// `await app.init(...)`. The async init means StrictMode's
// double-mount-in-dev needs a cancelled flag, otherwise the first
// pending init resolves into a unmounted host and leaks.
//
// Resizes route through `renderer.resize()` rather than recreating the
// Application. Recreating would destroy the stage Container that the
// outside renderer (PixiGroundRenderer) attached its scene graph to,
// invalidating its reference until the async re-init finished — the
// per-frame loop would then crash setting `.x` on a destroyed
// Container as soon as any UI element shifted the canvas size (e.g.
// the ActionStatus row appearing when the player commits to a sleep).

import { useEffect, useRef } from 'react'
import { Application } from 'pixi.js'

interface Props {
  /** Drawing-buffer width in CSS px. */
  width: number
  /** Drawing-buffer height in CSS px. */
  height: number
  /** RGB integer (e.g. 0x0a0a0d). */
  background?: number
  /**
   * Override host-div CSS. Default makes the host fixed at (width × height).
   * Set to e.g. `{ width: '100%', height: '100%' }` to let the canvas
   * CSS-scale to fit a sized parent — drawing buffer stays at width×height,
   * browser scales the rendered image.
   */
  hostStyle?: React.CSSProperties
  /** Called once the Application is initialized and the canvas is mounted. */
  onReady?: (app: Application) => void
}

export function PixiCanvas(props: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  // Latest-callback ref so passing an inline lambda doesn't churn the effect.
  const onReadyRef = useRef(props.onReady)
  onReadyRef.current = props.onReady
  // Hold latest size in a ref so a resize that lands before async init
  // completes still takes effect once the renderer is alive.
  const sizeRef = useRef({ w: props.width, h: props.height })
  sizeRef.current = { w: props.width, h: props.height }
  const backgroundRef = useRef(props.background)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false

    void (async () => {
      const a = new Application()
      await a.init({
        width: sizeRef.current.w,
        height: sizeRef.current.h,
        background: backgroundRef.current ?? 0x000000,
        antialias: false,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      })
      if (cancelled) {
        a.destroy(true, { children: true, texture: true })
        return
      }
      // Make the canvas CSS-fit its host. Pixi's autoDensity sets explicit
      // pixel dimensions in canvas.style; override so the host's chosen size
      // (default = width×height, but configurable via hostStyle) controls
      // the on-screen size.
      const canvasEl = a.canvas as HTMLCanvasElement
      canvasEl.style.width = '100%'
      canvasEl.style.height = '100%'
      canvasEl.style.display = 'block'
      host.appendChild(canvasEl)
      appRef.current = a
      // A resize prop that landed during init was deferred — apply now so
      // the renderer matches the latest size before onReady configures it.
      if (sizeRef.current.w !== a.renderer.width || sizeRef.current.h !== a.renderer.height) {
        a.renderer.resize(sizeRef.current.w, sizeRef.current.h)
      }
      onReadyRef.current?.(a)
    })()

    return () => {
      cancelled = true
      const a = appRef.current
      if (a) {
        a.destroy({ removeView: true }, { children: true, texture: true })
        appRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const a = appRef.current
    if (!a) return
    a.renderer.resize(props.width, props.height)
  }, [props.width, props.height])

  const style: React.CSSProperties = props.hostStyle
    ?? { width: props.width, height: props.height }
  return <div ref={hostRef} style={style} />
}
