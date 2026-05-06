import { useState, useRef, useCallback, useEffect, type MouseEvent } from 'react'

export interface MapViewBox {
  x: number
  y: number
  w: number
  h: number
}

export interface UseMapViewResult {
  viewBox: MapViewBox
  viewBoxAttr: string
  scale: number
  isDragging: boolean
  zoomIn: () => void
  zoomOut: () => void
  reset: () => void
  svgRef: (el: SVGSVGElement | null) => void
  onMouseDown: (e: MouseEvent<SVGSVGElement>) => void
  onMouseMove: (e: MouseEvent<SVGSVGElement>) => void
  onMouseUp: () => void
  onMouseLeave: () => void
}

const ZOOM_STEP = 0.65
const MAX_SCALE = 20

export function useMapView(
  mapW: number,
  mapH: number,
  initialBox: MapViewBox | null = null,
  // Optional snap target for zoom-in. When the current viewBox center sits
  // outside any meaningful content, MapPanel passes back the closest place
  // center so repeated clicks always converge on something visible. Without
  // this, zooming on the centroid of two spatially-separated procgen zones
  // landed in the empty corridor between them and rendered as black space.
  resolveZoomPivot: ((vb: MapViewBox) => { x: number; y: number } | null) | null = null,
): UseMapViewResult {
  // Fit-to-content view if provided; full scene otherwise. The full-scene
  // default is fine for tiny maps but useless for the live ones — content
  // sits in a few procgen zones and the rest of the scene is open ground,
  // so opening the map and zooming in on the center landed in empty space
  // and rendered as a flat dark rect.
  const initial = initialBox ?? { x: 0, y: 0, w: mapW, h: mapH }
  const [vb, setVb] = useState<MapViewBox>(initial)
  const [isDragging, setIsDragging] = useState(false)
  // Callback ref so the wheel useEffect re-runs when the SVG mounts/unmounts.
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null)
  const svgRef = useCallback((el: SVGSVGElement | null) => setSvgEl(el), [])

  const vbRef = useRef(vb)
  vbRef.current = vb

  // Pivot resolver is read inside zoom callbacks so we don't need to bust
  // their identity when MapPanel's place list changes — keep the latest in
  // a ref. Mid-render write is fine here; refs don't trigger re-renders.
  const pivotRef = useRef(resolveZoomPivot)
  pivotRef.current = resolveZoomPivot

  const dragRef = useRef<{
    startClientX: number
    startClientY: number
    startVbX: number
    startVbY: number
  } | null>(null)

  // Reset viewBox when scene dimensions or the fit-target rect change.
  const initialKey = `${initial.x},${initial.y},${initial.w},${initial.h}`
  useEffect(() => {
    setVb(initial)
    // initial is recomputed from primitive deps each render; key it on the
    // serialized rect so we don't loop on referentially-new objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapW, mapH, initialKey])

  // Pre-clamping w/h here matters: callers compute x,y as `pivot - frac * newW`,
  // and if `clamp` later inflates newW (we hit MAX_SCALE), the offset is no
  // longer correct and the pivot drifts. Repeated clicks at max zoom slid the
  // viewBox into the empty SE corner of the scene, which rendered as a flat
  // black rect with no markers — the "blackscreen" the user reported.
  const clampSize = useCallback((w: number, h: number) => ({
    w: Math.max(mapW / MAX_SCALE, Math.min(mapW, w)),
    h: Math.max(mapH / MAX_SCALE, Math.min(mapH, h)),
  }), [mapW, mapH])

  const clamp = useCallback((next: MapViewBox): MapViewBox => {
    const { w, h } = clampSize(next.w, next.h)
    const x = Math.max(0, Math.min(mapW - w, next.x))
    const y = Math.max(0, Math.min(mapH - h, next.y))
    return { x, y, w, h }
  }, [mapW, mapH, clampSize])

  // Non-passive wheel listener so preventDefault actually suppresses page scroll.
  // Depends on svgEl so it re-registers whenever the SVG mounts or unmounts.
  useEffect(() => {
    if (!svgEl) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const rect = svgEl.getBoundingClientRect()
      const mx = (e.clientX - rect.left) / rect.width
      const my = (e.clientY - rect.top) / rect.height
      const factor = e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP
      setVb((prev) => {
        const focusX = prev.x + mx * prev.w
        const focusY = prev.y + my * prev.h
        const { w: newW, h: newH } = clampSize(prev.w * factor, prev.h * factor)
        return clamp({
          x: focusX - mx * newW,
          y: focusY - my * newH,
          w: newW,
          h: newH,
        })
      })
    }
    svgEl.addEventListener('wheel', handler, { passive: false })
    return () => svgEl.removeEventListener('wheel', handler)
  }, [svgEl, clamp, clampSize])

  const zoomAt = useCallback((factor: number, useSnap: boolean) => {
    setVb((prev) => {
      const snap = useSnap ? pivotRef.current?.(prev) ?? null : null
      const cx = snap ? snap.x : prev.x + prev.w / 2
      const cy = snap ? snap.y : prev.y + prev.h / 2
      const { w: newW, h: newH } = clampSize(prev.w * factor, prev.h * factor)
      return clamp({ x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH })
    })
  }, [clamp, clampSize])

  const zoomIn = useCallback(() => zoomAt(ZOOM_STEP, true), [zoomAt])
  // Zoom-out keeps the current center so the user can step back to the
  // overview without the view jumping to a place they weren't looking at.
  const zoomOut = useCallback(() => zoomAt(1 / ZOOM_STEP, false), [zoomAt])
  const reset = useCallback(() => setVb(initial), [initialKey])  // eslint-disable-line react-hooks/exhaustive-deps

  const onMouseDown = useCallback((e: MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const cur = vbRef.current
    dragRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      startVbX: cur.x,
      startVbY: cur.y,
    }
    setIsDragging(true)
    e.preventDefault()
  }, [])

  const onMouseMove = useCallback((e: MouseEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    const cur = vbRef.current
    const dx = (e.clientX - drag.startClientX) / rect.width * cur.w
    const dy = (e.clientY - drag.startClientY) / rect.height * cur.h
    // Capture by value: React may invoke this updater on a later render
    // after stopDrag has cleared dragRef, which would null-deref here.
    const startVbX = drag.startVbX
    const startVbY = drag.startVbY
    setVb((prev) =>
      clamp({ x: startVbX - dx, y: startVbY - dy, w: prev.w, h: prev.h })
    )
  }, [clamp])

  const stopDrag = useCallback(() => {
    dragRef.current = null
    setIsDragging(false)
  }, [])

  const scale = mapW / vb.w
  const viewBoxAttr = `${vb.x} ${vb.y} ${vb.w} ${vb.h}`

  return {
    viewBox: vb,
    viewBoxAttr,
    scale,
    isDragging,
    zoomIn,
    zoomOut,
    reset,
    svgRef,
    onMouseDown,
    onMouseMove,
    onMouseUp: stopDrag,
    onMouseLeave: stopDrag,
  }
}

// Returns the highest tier visible at the given map scale.
// tier 1 = districts (always visible)
// tier 2 = complexes (medium zoom)
// tier 3 = pois / transit terminals (high zoom)
export function visibleTierAt(scale: number): 1 | 2 | 3 {
  if (scale < 2) return 1
  if (scale < 5) return 2
  return 3
}

export function placeKindTier(kind: 'district' | 'complex' | 'poi'): 1 | 2 | 3 {
  switch (kind) {
    case 'district': return 1
    case 'complex': return 2
    case 'poi': return 3
  }
}
