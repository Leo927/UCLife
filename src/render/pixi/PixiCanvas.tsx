// Phase 1 of the Konva → Pixi migration. Minimal React shim that owns a
// Pixi Application via raw useEffect — no @pixi/react. The renderer is
// driven imperatively from outside (the onReady callback gets the
// Application instance once it's initialized).
//
// Pixi v8 split construction from init: `new Application()` then
// `await app.init(...)`. The async init means StrictMode's
// double-mount-in-dev needs a cancelled flag, otherwise the first
// pending init resolves into a unmounted host and leaks.

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
  // Latest-callback ref so passing an inline lambda doesn't churn the effect.
  const onReadyRef = useRef(props.onReady)
  onReadyRef.current = props.onReady

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    let app: Application | null = null

    void (async () => {
      const a = new Application()
      await a.init({
        width: props.width,
        height: props.height,
        background: props.background ?? 0x000000,
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
      app = a
      onReadyRef.current?.(a)
    })()

    return () => {
      cancelled = true
      if (app) {
        app.destroy({ removeView: true }, { children: true, texture: true })
        app = null
      }
    }
  }, [props.width, props.height, props.background])

  const style: React.CSSProperties = props.hostStyle
    ?? { width: props.width, height: props.height }
  return <div ref={hostRef} style={style} />
}
