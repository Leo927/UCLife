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
  width: number
  height: number
  /** RGB integer (e.g. 0x0a0a0d). */
  background?: number
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
      host.appendChild(a.canvas)
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

  return <div ref={hostRef} style={{ width: props.width, height: props.height }} />
}
