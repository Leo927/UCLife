import { useCallback, useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { useQueryFirst, useTrait, useQuery } from 'koota/react'
import { IsPlayer, Position, Building, MoveTarget, QueuedInteract, Action } from '../ecs/traits'
import { worldConfig } from '../config'
import { getActiveSceneDimensions } from '../ecs/world'
import { useScene } from '../sim/scene'
import { getSceneConfig } from '../data/scenes'
import { getPlacesInScene, type WorldPlace } from '../data/worldMap'
import { flightHubs } from '../data/flights'
import { getAirportPlacement } from '../sim/airportPlacements'
import { getTransitPlacement } from '../sim/transitPlacements'
import { transitTerminals } from '../data/transit'
import { useUI } from './uiStore'
import { useMapView, visibleTierAt, placeKindTier, type MapViewBox } from './useMapView'

const TILE = worldConfig.tilePx

const VIEW_W = 480

const MIN_MARKER_TILES = 6

function placeColor(kind: WorldPlace['kind']): string {
  switch (kind) {
    case 'district': return '#4ade80'
    case 'complex':  return '#facc15'
    case 'poi':      return '#60a5fa'
  }
}

interface PlaceMarkerProps {
  place: WorldPlace
  scale: number
  hideLabel?: boolean
}

function PlaceMarker({ place, scale, hideLabel = false }: PlaceMarkerProps) {
  const w = Math.max(place.tileW, MIN_MARKER_TILES)
  const h = Math.max(place.tileH, MIN_MARKER_TILES)
  const x = place.tileX - (w - place.tileW) / 2
  const y = place.tileY - (h - place.tileH) / 2
  const cx = x + w / 2
  const cy = y + h / 2
  const color = placeColor(place.kind)
  const fontSize = Math.max(4, Math.round(11 / scale))
  return (
    <g>
      <rect
        x={x} y={y} width={w} height={h}
        fill={color} fillOpacity={0.18}
        stroke={color} strokeWidth={1.5 / scale}
        rx={2 / scale}
      />
      {!hideLabel && (
        <text
          x={cx} y={cy}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={color}
          fontSize={fontSize}
          style={{ paintOrder: 'stroke', stroke: '#0d0d10', strokeWidth: 3 / scale }}
        >
          {place.shortZh}
        </text>
      )}
    </g>
  )
}

interface TransitDotProps {
  cx: number
  cy: number
  scale: number
}

function TransitDot({ cx, cy, scale }: TransitDotProps) {
  const r = Math.max(1.5, 5 / scale)
  const fontSize = Math.max(3, 8 / scale)
  return (
    <g>
      <circle
        cx={cx} cy={cy} r={r}
        fill="#134e4a"
        stroke="#2dd4bf"
        strokeWidth={1 / scale}
      />
      <circle cx={cx} cy={cy} r={r * 0.4} fill="#2dd4bf" />
      <text
        x={cx} y={cy - r - 1.5 / scale}
        textAnchor="middle"
        fill="#2dd4bf"
        fontSize={fontSize}
        style={{ paintOrder: 'stroke', stroke: '#0d0d10', strokeWidth: 2 / scale }}
      >
        T
      </text>
    </g>
  )
}

// Initial viewBox = the smallest rect that covers every procgen zone and
// fixed building, padded a bit so markers near the edges aren't clipped.
// Falls back to the whole scene when nothing meaningful is declared (ship
// scenes, the zumCity stub today). Without this the default view of a
// 800×520 city was 90% open ground with the procgen tucked in a corner —
// zoom-in on the viewBox center then converged on empty space.
function fitToContentBox(sceneId: string, tilesX: number, tilesY: number): MapViewBox | null {
  const cfg = getSceneConfig(sceneId)
  if (cfg.sceneType !== 'micro') return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const z of cfg.procgenZones ?? []) {
    if (!z.enabled) continue
    minX = Math.min(minX, z.rect.x)
    minY = Math.min(minY, z.rect.y)
    maxX = Math.max(maxX, z.rect.x + z.rect.w)
    maxY = Math.max(maxY, z.rect.y + z.rect.h)
  }
  for (const fb of cfg.fixedBuildings ?? []) {
    minX = Math.min(minX, fb.tile.x)
    minY = Math.min(minY, fb.tile.y)
    // Approximate fixed-building footprint without coupling to buildingTypes.
    // 30 tiles is larger than any current fixedBuilding (aeComplex is 28×26)
    // so the bbox always encloses it.
    maxX = Math.max(maxX, fb.tile.x + 30)
    maxY = Math.max(maxY, fb.tile.y + 30)
  }
  if (!Number.isFinite(minX)) return null
  const PAD = 8
  const left = Math.max(0, minX - PAD)
  const top = Math.max(0, minY - PAD)
  const right = Math.min(tilesX, maxX + PAD)
  const bottom = Math.min(tilesY, maxY + PAD)
  return { x: left, y: top, w: right - left, h: bottom - top }
}

// As long as any place still overlaps the viewBox the user is looking at
// content — preserve their pan intent and zoom on the current center.
// Once every place has scrolled out of view, snap to the closest one so
// further clicks always converge on something visible.
function closestPlacePivot(
  vb: MapViewBox,
  places: readonly WorldPlace[],
): { x: number; y: number } | null {
  if (places.length === 0) return null
  for (const p of places) {
    if (vb.x < p.tileX + p.tileW && vb.x + vb.w > p.tileX
     && vb.y < p.tileY + p.tileH && vb.y + vb.h > p.tileY) {
      return null
    }
  }
  const cx = vb.x + vb.w / 2
  const cy = vb.y + vb.h / 2
  let bestX = cx, bestY = cy, bestD = Infinity
  for (const p of places) {
    const px = p.tileX + p.tileW / 2
    const py = p.tileY + p.tileH / 2
    const d = Math.hypot(px - cx, py - cy)
    if (d < bestD) {
      bestD = d
      bestX = px
      bestY = py
    }
  }
  return { x: bestX, y: bestY }
}

export function MapPanel() {
  const open = useUI((s) => s.mapOpen)
  const setOpen = useUI((s) => s.setMap)
  const player = useQueryFirst(IsPlayer, Position)
  const playerPos = useTrait(player, Position)
  const activeSceneId = useScene((s) => s.activeId)

  // Resolve map dimensions before any early return so hooks stay unconditional.
  const { tilesX: MAP_TILES_X, tilesY: MAP_TILES_Y } = getActiveSceneDimensions()
  const VIEW_H = Math.round(VIEW_W * (MAP_TILES_Y / MAP_TILES_X))

  const initialBox = useMemo(
    () => fitToContentBox(activeSceneId, MAP_TILES_X, MAP_TILES_Y),
    [activeSceneId, MAP_TILES_X, MAP_TILES_Y],
  )
  // For vonBraunCity the procgen zones are spatially separated, so the centroid
  // of fit-to-content sits in empty space between them. Without a snap, the
  // first zoom-in click already converges on dark ground. Ship/space scenes
  // have no places — return null so zoomIn falls back to viewBox center.
  const placesForScene = useMemo(
    () => getPlacesInScene(activeSceneId),
    [activeSceneId],
  )
  const resolveZoomPivot = useCallback(
    (vb: MapViewBox) => closestPlacePivot(vb, placesForScene),
    [placesForScene],
  )
  const {
    viewBoxAttr, scale, isDragging,
    zoomIn, zoomOut, reset,
    svgRef, onMouseDown, onMouseMove, onMouseUp, onMouseLeave,
  } = useMapView(MAP_TILES_X, MAP_TILES_Y, initialBox, resolveZoomPivot)
  const buildingEnts = useQuery(Building)

  // Right-click-to-navigate. Left-click is reserved for pan (useMapView). We
  // record the right-button press position so we can suppress navigation when
  // the user actually dragged (right-button drag isn't pan, but we still want
  // a movement threshold to reject accidental swipes).
  const pressRef = useRef<{ x: number; y: number } | null>(null)

  if (!open) return null

  // Airports are procgen-placed; pull from the runtime registry.
  const airportPlaces: WorldPlace[] = []
  for (const h of flightHubs) {
    if (h.sceneId !== activeSceneId) continue
    const p = getAirportPlacement(h.id)
    if (!p) continue
    airportPlaces.push({
      id: h.id,
      sceneId: h.sceneId,
      nameZh: h.nameZh,
      shortZh: h.shortZh,
      kind: 'complex',
      tileX: p.rectTile.x,
      tileY: p.rectTile.y,
      tileW: p.rectTile.w,
      tileH: p.rectTile.h,
      description: h.description,
    })
  }
  const allPlaces = [...getPlacesInScene(activeSceneId), ...airportPlaces]
  const airportIds = new Set(airportPlaces.map((p) => p.id))

  const maxTier = visibleTierAt(scale)
  const places = allPlaces.filter((p) => placeKindTier(p.kind) <= maxTier)

  // At high zoom, show transit terminal icons (tier 3).
  const transitDots: Array<{ id: string; cx: number; cy: number }> = []
  if (maxTier >= 3) {
    for (const t of transitTerminals) {
      if (t.sceneId !== activeSceneId) continue
      const pl = getTransitPlacement(t.id)
      if (!pl) continue
      transitDots.push({ id: t.id, cx: pl.terminalPx.x / TILE, cy: pl.terminalPx.y / TILE })
    }
  }

  const showBuildings = scale >= 4
  const showBuildingLabels = scale >= 10
  const buildings = showBuildings
    ? buildingEnts.flatMap((ent) => {
        const b = ent.get(Building)
        if (!b) return []
        return [{
          id: ent.id(),
          x: b.x / TILE, y: b.y / TILE, w: b.w / TILE, h: b.h / TILE,
          label: b.label,
        }]
      })
    : []

  const close = () => setOpen(false)
  const playerTileX = playerPos ? playerPos.x / TILE : null
  const playerTileY = playerPos ? playerPos.y / TILE : null
  const playerR = Math.max(2, 6 / scale)

  const handleMouseDown = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (e.button === 2) pressRef.current = { x: e.clientX, y: e.clientY }
    onMouseDown(e)
  }
  const handleContextMenu = (e: ReactMouseEvent<SVGSVGElement>) => {
    e.preventDefault()
    const press = pressRef.current
    pressRef.current = null
    if (!press || !player) return
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) return

    const svg = e.currentTarget
    const ctm = svg.getScreenCTM()
    if (!ctm) return
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const u = pt.matrixTransform(ctm.inverse())
    const px = Math.max(0, Math.min(MAP_TILES_X * TILE, u.x * TILE))
    const py = Math.max(0, Math.min(MAP_TILES_Y * TILE, u.y * TILE))

    const action = player.get(Action)
    if (action && action.kind !== 'idle' && action.kind !== 'walking') {
      player.set(Action, { kind: 'idle', remaining: 0, total: 0 })
    }
    player.set(MoveTarget, { x: px, y: py })
    if (player.has(QueuedInteract)) player.remove(QueuedInteract)
  }

  return (
    <div className="status-overlay" onClick={close}>
      <div className="status-panel map-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>地图</h2>
          <button className="status-close" onClick={close} aria-label="关闭">✕</button>
        </header>
        <section className="status-section map-body">
          <div className="map-controls">
            <button className="map-zoom-btn" onClick={zoomIn} aria-label="放大">＋</button>
            <button className="map-zoom-btn" onClick={zoomOut} aria-label="缩小">－</button>
            <button className="map-zoom-btn map-zoom-reset" onClick={reset} aria-label="复位">⊙</button>
            <span className="map-zoom-level">{Math.round(scale * 100)}%</span>
            <span className="map-hint">右键地图前往该地点</span>
          </div>
          <svg
            ref={svgRef}
            className={`map-svg${isDragging ? ' is-dragging' : ''}`}
            viewBox={viewBoxAttr}
            width={VIEW_W}
            height={VIEW_H}
            preserveAspectRatio="xMidYMid meet"
            onMouseDown={handleMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseLeave}
            onContextMenu={handleContextMenu}
          >
            <rect
              x={0} y={0} width={MAP_TILES_X} height={MAP_TILES_Y}
              fill="#0a0a0d" stroke="#2a2a32" strokeWidth={2 / scale}
            />
            {buildings.map((b) => (
              <g key={b.id}>
                <rect
                  x={b.x} y={b.y} width={b.w} height={b.h}
                  fill="#9ca3af" fillOpacity={0.14}
                  stroke="#9ca3af" strokeOpacity={0.55}
                  strokeWidth={0.5 / scale}
                />
                {showBuildingLabels && b.label && (
                  <text
                    x={b.x + b.w / 2} y={b.y + b.h / 2 + 1.5 / scale}
                    textAnchor="middle"
                    fill="#e5e7eb"
                    fontSize={Math.max(2.5, 7 / scale)}
                    style={{ paintOrder: 'stroke', stroke: '#0d0d10', strokeWidth: 1 / scale }}
                  >
                    {b.label}
                  </text>
                )}
              </g>
            ))}
            {places.map((p) => (
              <PlaceMarker
                key={p.id}
                place={p}
                scale={scale}
                hideLabel={showBuildingLabels && airportIds.has(p.id)}
              />
            ))}
            {transitDots.map((d) => (
              <TransitDot key={d.id} cx={d.cx} cy={d.cy} scale={scale} />
            ))}
            {playerTileX !== null && playerTileY !== null && (
              <g>
                <circle
                  cx={playerTileX} cy={playerTileY} r={playerR}
                  fill="#ef4444" stroke="#0d0d10" strokeWidth={1.5 / scale}
                />
                <circle
                  cx={playerTileX} cy={playerTileY} r={playerR * 2.5}
                  fill="none" stroke="#ef4444" strokeWidth={1 / scale} opacity={0.6}
                >
                  <animate
                    attributeName="r" from={playerR} to={playerR * 3.5}
                    dur="1.6s" repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity" from={0.6} to={0}
                    dur="1.6s" repeatCount="indefinite"
                  />
                </circle>
              </g>
            )}
          </svg>
          <div className="map-legend">
            <span className="map-legend-item">
              <span className="map-legend-dot" style={{ background: '#ef4444' }} /> 你
            </span>
            <span className="map-legend-item">
              <span className="map-legend-dot" style={{ background: '#4ade80' }} /> 居住区
            </span>
            <span className="map-legend-item">
              <span className="map-legend-dot" style={{ background: '#facc15' }} /> 企业园区
            </span>
            {maxTier >= 3 && (
              <span className="map-legend-item">
                <span className="map-legend-dot" style={{ background: '#2dd4bf' }} /> 换乘站
              </span>
            )}
          </div>
        </section>
        <section className="status-section map-places">
          {places.map((p) => {
            const isHere = playerTileX !== null && playerTileY !== null
              && playerTileX >= p.tileX && playerTileX < p.tileX + p.tileW
              && playerTileY >= p.tileY && playerTileY < p.tileY + p.tileH
            return (
              <div key={p.id} className="map-place-row">
                <div className="map-place-head">
                  <span
                    className="map-place-swatch"
                    style={{ background: placeColor(p.kind) }}
                  />
                  <span className="map-place-name">{p.nameZh}</span>
                  {isHere && <span className="map-place-here">所在地</span>}
                </div>
                {p.description && (
                  <p className="map-place-desc">{p.description}</p>
                )}
              </div>
            )
          })}
        </section>
      </div>
    </div>
  )
}
