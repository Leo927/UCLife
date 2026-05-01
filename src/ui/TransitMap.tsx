import { useQueryFirst, useTrait } from 'koota/react'
import { IsPlayer, Position, MoveTarget, Action, Path } from '../ecs/traits'
import { worldConfig } from '../config'
import { getActiveSceneDimensions } from '../ecs/world'
import { useScene } from '../sim/scene'
import { getPlacesInScene, type WorldPlace } from '../data/worldMap'
import { getTransitTerminal, getTransitDestinationsFor, type TransitTerminal } from '../data/transit'
import { useUI } from './uiStore'
import { runTransition, useTransition } from '../sim/transition'

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

interface TerminalMarkerProps {
  terminal: TransitTerminal
  isSource: boolean
  onClick: () => void
}

function TerminalMarker({ terminal, isSource, onClick }: TerminalMarkerProps) {
  const cx = terminal.terminalTile.x
  const cy = terminal.terminalTile.y
  const r = 7
  return (
    <g
      className={`transit-terminal-marker${isSource ? ' is-source' : ''}`}
      onClick={isSource ? undefined : onClick}
    >
      <circle
        cx={cx} cy={cy} r={r}
        fill="#134e4a"
        stroke="#2dd4bf"
        strokeWidth={1.5}
      />
      <circle
        cx={cx} cy={cy} r={r * 0.45}
        fill="#2dd4bf"
      />
      {!isSource && (
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke="#2dd4bf"
          strokeWidth={1}
          opacity={0.5}
        >
          <animate
            attributeName="r" from={r} to={r + 6}
            dur="2s" repeatCount="indefinite"
          />
          <animate
            attributeName="opacity" from={0.5} to={0}
            dur="2s" repeatCount="indefinite"
          />
        </circle>
      )}
    </g>
  )
}

export function TransitMap() {
  const sourceId = useUI((s) => s.transitSourceId)
  const close = useUI((s) => s.closeTransit)
  const player = useQueryFirst(IsPlayer, Position)
  const playerPos = useTrait(player, Position)
  const inTransition = useTransition((s) => s.inProgress)
  const activeSceneId = useScene((s) => s.activeId)

  if (!sourceId) return null
  const source = getTransitTerminal(sourceId)
  if (!source) return null

  const { tilesX: MAP_TILES_X, tilesY: MAP_TILES_Y } = getActiveSceneDimensions()
  const VIEW_H = Math.round(VIEW_W * (MAP_TILES_Y / MAP_TILES_X))
  const places = getPlacesInScene(activeSceneId)
  const terminals = getTransitDestinationsFor(sourceId)

  const playerTileX = playerPos ? playerPos.x / TILE : null
  const playerTileY = playerPos ? playerPos.y / TILE : null

  // Close before runTransition so the panel doesn't flash through the
  // fade-out — the cover still needs a frame to mount.
  const travel = (dest: TransitTerminal) => {
    if (!player) return
    if (inTransition) return
    close()
    runTransition({
      midpoint: () => {
        const px = dest.arrivalTile.x * TILE
        const py = dest.arrivalTile.y * TILE
        player.set(Position, { x: px, y: py })
        // Clear in-flight target / cached path so the player doesn't turn
        // around and walk back toward where they were going.
        player.set(MoveTarget, { x: px, y: py })
        if (player.has(Path)) player.remove(Path)
        const a = player.get(Action)
        if (a && a.kind === 'walking') {
          player.set(Action, { kind: 'idle', remaining: 0, total: 0 })
        }
      },
    })
  }

  return (
    <div className="status-overlay" onClick={close}>
      <div className="status-panel map-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>公共交通 · {source.nameZh}</h2>
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
            {terminals.map((t) => (
              <TerminalMarker
                key={t.id}
                terminal={t}
                isSource={t.id === source.id}
                onClick={() => travel(t)}
              />
            ))}
            {playerTileX !== null && playerTileY !== null && (
              <g>
                <circle
                  cx={playerTileX} cy={playerTileY} r={4}
                  fill="#ef4444" stroke="#0d0d10" strokeWidth={1}
                />
              </g>
            )}
          </svg>
          <div className="map-legend">
            <span className="map-legend-item">
              <span className="map-legend-dot" style={{ background: '#2dd4bf' }} /> 换乘站
            </span>
            <span className="map-legend-item">
              <span className="map-legend-dot" style={{ background: '#ef4444' }} /> 你
            </span>
          </div>
        </section>
        <section className="status-section">
          {terminals.map((t) => {
            const isSrc = t.id === source.id
            return (
              <div key={t.id} className="transit-terminal-row">
                <div className="transit-terminal-info">
                  <div className="transit-terminal-name">
                    {t.nameZh}
                    {isSrc && <span className="transit-terminal-here">所在地</span>}
                  </div>
                  {t.description && (
                    <p className="transit-terminal-desc">{t.description}</p>
                  )}
                </div>
                <button
                  className="transit-terminal-go"
                  onClick={() => travel(t)}
                  disabled={isSrc || inTransition}
                >
                  {isSrc ? '当前' : '前往'}
                </button>
              </div>
            )
          })}
        </section>
      </div>
    </div>
  )
}
