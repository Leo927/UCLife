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

export function useMapView(mapW: number, mapH: number): UseMapViewResult {
  const [vb, setVb] = useState<MapViewBox>({ x: 0, y: 0, w: mapW, h: mapH })
  const [isDragging, setIsDragging] = useState(false)
  // Callback ref so the wheel useEffect re-runs when the SVG mounts/unmounts.
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null)
  const svgRef = useCallback((el: SVGSVGElement | null) => setSvgEl(el), [])

  const vbRef = useRef(vb)
  vbRef.current = vb

  const dragRef = useRef<{
    startClientX: number
    startClientY: number
    startVbX: number
    startVbY: number
  } | null>(null)

  // Reset viewBox when scene dimensions change.
  useEffect(() => {
    setVb({ x: 0, y: 0, w: mapW, h: mapH })
  }, [mapW, mapH])

  const clamp = useCallback((next: MapViewBox): MapViewBox => {
    const w = Math.max(mapW / MAX_SCALE, Math.min(mapW, next.w))
    const h = Math.max(mapH / MAX_SCALE, Math.min(mapH, next.h))
    const x = Math.max(0, Math.min(mapW - w, next.x))
    const y = Math.max(0, Math.min(mapH - h, next.y))
    return { x, y, w, h }
  }, [mapW, mapH])

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
        const newW = prev.w * factor
        const newH = prev.h * factor
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
  }, [svgEl, clamp])

  const zoomAt = useCallback((factor: number) => {
    setVb((prev) => {
      const cx = prev.x + prev.w / 2
      const cy = prev.y + prev.h / 2
      const newW = prev.w * factor
      const newH = prev.h * factor
      return clamp({ x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH })
    })
  }, [clamp])

  const zoomIn = useCallback(() => zoomAt(ZOOM_STEP), [zoomAt])
  const zoomOut = useCallback(() => zoomAt(1 / ZOOM_STEP), [zoomAt])
  const reset = useCallback(() => setVb({ x: 0, y: 0, w: mapW, h: mapH }), [mapW, mapH])

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
    if (!dragRef.current) return
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    const cur = vbRef.current
    const dx = (e.clientX - dragRef.current.startClientX) / rect.width * cur.w
    const dy = (e.clientY - dragRef.current.startClientY) / rect.height * cur.h
    setVb((prev) =>
      clamp({ x: dragRef.current!.startVbX - dx, y: dragRef.current!.startVbY - dy, w: prev.w, h: prev.h })
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
