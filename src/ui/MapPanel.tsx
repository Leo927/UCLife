import { useQueryFirst, useTrait } from 'koota/react'
import { IsPlayer, Position } from '../ecs/traits'
import { worldConfig } from '../config'
import { getActiveSceneDimensions } from '../ecs/world'
import { useScene } from '../sim/scene'
import { getPlacesInScene, type WorldPlace } from '../data/worldMap'
import { useUI } from './uiStore'

const TILE = worldConfig.tilePx

const VIEW_W = 480

// Floor marker size so single-tile POIs don't disappear.
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
}

function PlaceMarker({ place, labelAbove }: PlaceMarkerProps) {
  const w = Math.max(place.tileW, MIN_MARKER_TILES)
  const h = Math.max(place.tileH, MIN_MARKER_TILES)
  const x = place.tileX - (w - place.tileW) / 2
  const y = place.tileY - (h - place.tileH) / 2
  const cx = x + w / 2
  const labelY = labelAbove ? y - 4 : y + h + 14
  const color = placeColor(place.kind)
  return (
    <g>
      <rect
        x={x} y={y} width={w} height={h}
        fill={color} fillOpacity={0.18}
        stroke={color} strokeWidth={1.5}
        rx={2}
      />
      <text
        x={cx} y={labelY}
        textAnchor="middle"
        fill={color}
        fontSize={11}
        style={{ paintOrder: 'stroke', stroke: '#0d0d10', strokeWidth: 3 }}
      >
        {place.shortZh}
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

  if (!open) return null

  const { tilesX: MAP_TILES_X, tilesY: MAP_TILES_Y } = getActiveSceneDimensions()
  const VIEW_H = Math.round(VIEW_W * (MAP_TILES_Y / MAP_TILES_X))
  const places = getPlacesInScene(activeSceneId)

  const close = () => setOpen(false)
  const playerTileX = playerPos ? playerPos.x / TILE : null
  const playerTileY = playerPos ? playerPos.y / TILE : null

  return (
    <div className="status-overlay" onClick={close}>
      <div className="status-panel map-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>地图</h2>
          <button className="status-close" onClick={close} aria-label="关闭">✕</button>
        </header>
        <section className="status-section">
          <svg
            className="map-svg"
            viewBox={`0 0 ${MAP_TILES_X} ${MAP_TILES_Y}`}
            width={VIEW_W}
            height={VIEW_H}
            preserveAspectRatio="xMidYMid meet"
          >
            <rect
              x={0} y={0} width={MAP_TILES_X} height={MAP_TILES_Y}
              fill="#0a0a0d" stroke="#2a2a32" strokeWidth={2}
            />
            {places.map((p) => (
              <PlaceMarker
                key={p.id}
                place={p}
                labelAbove={p.tileY + p.tileH > MAP_TILES_Y - 30}
              />
            ))}
            {playerTileX !== null && playerTileY !== null && (
              <g>
                <circle
                  cx={playerTileX} cy={playerTileY} r={6}
                  fill="#ef4444" stroke="#0d0d10" strokeWidth={1.5}
                />
                <circle
                  cx={playerTileX} cy={playerTileY} r={14}
                  fill="none" stroke="#ef4444" strokeWidth={1} opacity={0.6}
                >
                  <animate
                    attributeName="r" from={8} to={20}
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
