import { useQueryFirst, useTrait } from 'koota/react'
import { IsPlayer, Position } from '../ecs/traits'
import { worldConfig } from '../config'
import { getActiveSceneDimensions } from '../ecs/world'
import { useScene } from '../sim/scene'
import { getPlacesInScene, type WorldPlace } from '../data/worldMap'
import { flightHubs } from '../data/flights'
import { getAirportPlacement } from '../sim/airportPlacements'
import { getTransitPlacement } from '../sim/transitPlacements'
import { transitTerminals } from '../data/transit'
import { useUI } from './uiStore'
import { useMapView, visibleTierAt, placeKindTier } from './useMapView'

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
  labelAbove: boolean
  scale: number
}

function PlaceMarker({ place, labelAbove, scale }: PlaceMarkerProps) {
  const w = Math.max(place.tileW, MIN_MARKER_TILES)
  const h = Math.max(place.tileH, MIN_MARKER_TILES)
  const x = place.tileX - (w - place.tileW) / 2
  const y = place.tileY - (h - place.tileH) / 2
  const cx = x + w / 2
  const labelY = labelAbove ? y - 4 : y + h + 14
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
      <text
        x={cx} y={labelY}
        textAnchor="middle"
        fill={color}
        fontSize={fontSize}
        style={{ paintOrder: 'stroke', stroke: '#0d0d10', strokeWidth: 3 / scale }}
      >
        {place.shortZh}
      </text>
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

export function MapPanel() {
  const open = useUI((s) => s.mapOpen)
  const setOpen = useUI((s) => s.setMap)
  const player = useQueryFirst(IsPlayer, Position)
  const playerPos = useTrait(player, Position)
  const activeSceneId = useScene((s) => s.activeId)

  // Resolve map dimensions before any early return so hooks stay unconditional.
  const { tilesX: MAP_TILES_X, tilesY: MAP_TILES_Y } = getActiveSceneDimensions()
  const VIEW_H = Math.round(VIEW_W * (MAP_TILES_Y / MAP_TILES_X))

  const {
    viewBoxAttr, scale, isDragging,
    zoomIn, zoomOut, reset,
    svgRef, onMouseDown, onMouseMove, onMouseUp, onMouseLeave,
  } = useMapView(MAP_TILES_X, MAP_TILES_Y)

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

  const close = () => setOpen(false)
  const playerTileX = playerPos ? playerPos.x / TILE : null
  const playerTileY = playerPos ? playerPos.y / TILE : null
  const playerR = Math.max(2, 6 / scale)

  return (
    <div className="status-overlay" onClick={close}>
      <div className="status-panel map-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>地图</h2>
          <button className="status-close" onClick={close} aria-label="关闭">✕</button>
        </header>
        <section className="status-section">
          <div className="map-controls">
            <button className="map-zoom-btn" onClick={zoomIn} aria-label="放大">＋</button>
            <button className="map-zoom-btn" onClick={zoomOut} aria-label="缩小">－</button>
            <button className="map-zoom-btn map-zoom-reset" onClick={reset} aria-label="复位">⊙</button>
            <span className="map-zoom-level">{Math.round(scale * 100)}%</span>
          </div>
          <svg
            ref={svgRef}
            className={`map-svg${isDragging ? ' is-dragging' : ''}`}
            viewBox={viewBoxAttr}
            width={VIEW_W}
            height={VIEW_H}
            preserveAspectRatio="xMidYMid meet"
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseLeave}
          >
            <rect
              x={0} y={0} width={MAP_TILES_X} height={MAP_TILES_Y}
              fill="#0a0a0d" stroke="#2a2a32" strokeWidth={2 / scale}
            />
            {places.map((p) => (
              <PlaceMarker
                key={p.id}
                place={p}
                scale={scale}
                labelAbove={p.tileY + p.tileH > MAP_TILES_Y - 30}
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
        <section className="status-section">
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
