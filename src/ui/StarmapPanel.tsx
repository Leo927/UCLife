import { useEffect, useRef, useState } from 'react'
import { useUI } from './uiStore'
import {
  STARMAP, getPoi, getRegion, burnCostBetween, distancePos,
  POI_SNAP_RADIUS, nearestSnappablePoi,
  type FactionKey, type MapPos, type Poi, type BurnCost,
} from '../data/starmap'
import { getShipState, getDockedPoiId, getBurnPlan } from '../sim/ship'
import { burnToPos, burnToPoi, canBurnToPos, getBurnProgress } from '../systems/starmap'

const FACTION_COLOR: Record<FactionKey, string> = {
  civilian: '#94a3b8',
  efsf: '#3b82f6',
  ae: '#f59e0b',
  zeon: '#dc2626',
  pirate: '#7c3aed',
  neutral: '#a3a3a3',
  none: '#525252',
}

const FACTION_LABEL: Record<FactionKey, string> = {
  civilian: '民用',
  efsf: '联邦军',
  ae: 'AE',
  zeon: '吉翁',
  pirate: '海盗',
  neutral: '中立',
  none: '无主',
}

const SERVICE_LABEL: Record<string, string> = {
  refuel: '补给燃料',
  repair: '维修',
  refit: '改装',
  hire: '雇佣',
  store: '商店',
  news: '情报',
}

const TYPE_LABEL: Record<string, string> = {
  colony: '殖民地',
  station: '空间站',
  asteroid: '小行星',
  derelict: '漂流船',
  patrol: '巡逻区',
  distress: '求救信号',
  mining: '矿场',
  anomaly: '异常',
  shipyard: '船坞',
  salvage: '废料场',
}

const FAIL_HINT: Record<string, string> = {
  'no-ship': '没有飞船',
  'no-origin': '舰队位置未知',
  'unknown-poi': '未知坐标',
  'insufficient-fuel': '燃料不足',
  'insufficient-supplies': '补给不足',
  'in-transition': '正在切换',
  'in-burn': '航行中',
  'too-close': '距离过近',
}

function formatDuration(min: number): string {
  if (min < 60) return `${min} 分钟`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (m === 0) return `${h} 小时`
  return `${h} 小时 ${m} 分钟`
}

interface PlannedTarget {
  pos: MapPos
  poi: Poi | null
}

export function StarmapPanel() {
  const open = useUI((s) => s.starmapOpen)
  const setStarmap = useUI((s) => s.setStarmap)

  // Re-render every frame while open so the fleet token visibly traverses
  // along the burn plan. Cheap: the SVG redraw is small and only fires
  // while this overlay is mounted.
  const [, setFrame] = useState(0)
  useEffect(() => {
    if (!open) return
    let id = 0
    const loop = () => {
      setFrame((n) => (n + 1) & 0xfffff)
      id = requestAnimationFrame(loop)
    }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [open])

  const svgRef = useRef<SVGSVGElement | null>(null)
  const [hoveredPos, setHoveredPos] = useState<MapPos | null>(null)
  const [planned, setPlanned] = useState<PlannedTarget | null>(null)

  if (!open) return null

  const ship = getShipState()
  const burn = getBurnPlan()
  const dockedId = getDockedPoiId()
  const dockedPoi = dockedId ? getPoi(dockedId) ?? null : null
  const fleetPos: MapPos | null = ship ? { x: ship.fleetPos.x, y: ship.fleetPos.y } : null

  const close = () => {
    setStarmap(false)
    setHoveredPos(null)
    setPlanned(null)
  }

  // Snap a hover/click coordinate either to a nearby POI or leave it as
  // free-space coords. Hover preview uses the same snap so the cursor
  // visually "grips" landmarks.
  function resolveTarget(rawPos: MapPos): PlannedTarget {
    const snap = nearestSnappablePoi(rawPos)
    if (snap) return { pos: snap.pos, poi: snap }
    return { pos: rawPos, poi: null }
  }

  function svgFromEvent(e: React.MouseEvent): MapPos | null {
    const svg = svgRef.current
    if (!svg) return null
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const local = pt.matrixTransform(ctm.inverse())
    return { x: local.x, y: local.y }
  }

  // Sort majors first, procedural last — keeps the labeled UC POIs
  // visually dominant while the seeded minor scatter sits in the
  // background.
  const orderedPois = [...STARMAP.pois].sort((a, b) => {
    if (!!a.procedural === !!b.procedural) return 0
    return a.procedural ? 1 : -1
  })

  const burning = burn != null
  const previewTarget: PlannedTarget | null = burning
    ? null
    : (planned ?? (hoveredPos ? resolveTarget(hoveredPos) : null))
  const previewCost: BurnCost | null = previewTarget && fleetPos
    ? burnCostBetween(fleetPos, previewTarget.pos)
    : null
  const previewBlock = previewTarget && !burning
    ? canBurnToPos(previewTarget.pos)
    : { ok: true as const }

  const handleSvgMove = (e: React.MouseEvent) => {
    if (burning) return
    const p = svgFromEvent(e)
    if (p) setHoveredPos(p)
  }
  const handleSvgLeave = () => setHoveredPos(null)
  const handleSvgClick = (e: React.MouseEvent) => {
    if (burning) return
    const p = svgFromEvent(e)
    if (!p) return
    setPlanned(resolveTarget(p))
  }

  const commitBurn = () => {
    if (!planned) return
    if (planned.poi) burnToPoi(planned.poi.id)
    else burnToPos(planned.pos, null)
    setPlanned(null)
  }

  return (
    <div className="status-overlay" onClick={close}>
      <style>{`
        @keyframes starmap-pulse-ring {
          0% { r: 3; opacity: 1; }
          100% { r: 7; opacity: 0; }
        }
        .starmap-pulse {
          animation: starmap-pulse-ring 1.6s ease-out infinite;
          transform-origin: center;
        }
      `}</style>
      <div
        className="status-panel starmap-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="status-header">
          <h2>星图 · 地球圈</h2>
          <button className="status-close" onClick={close} aria-label="关闭">✕</button>
        </header>

        {!ship ? (
          <section className="status-section">
            <p className="map-place-desc">尚未拥有飞船。</p>
          </section>
        ) : (
          <>
            <section className="status-section">
              <div className="starmap-status">
                <span>
                  当前位置 · {dockedPoi ? dockedPoi.nameZh : (burning ? '航行中' : '空域漂流')}
                </span>
                <span>燃料 {ship.fuelCurrent}/{ship.fuelMax}</span>
                <span>补给 {ship.suppliesCurrent}/{ship.suppliesMax}</span>
                <span>装甲 {Math.round(ship.armorCurrent)}/{ship.armorMax}</span>
                <span>船体 {Math.round(ship.hullCurrent)}/{ship.hullMax}</span>
              </div>
            </section>

            <div className="starmap-body">
              <div className="starmap-graph">
                <svg
                  ref={svgRef}
                  viewBox="0 0 100 100"
                  className="starmap-svg"
                  preserveAspectRatio="xMidYMid meet"
                  onMouseMove={handleSvgMove}
                  onMouseLeave={handleSvgLeave}
                  onClick={handleSvgClick}
                  style={{ cursor: burning ? 'progress' : 'crosshair' }}
                >
                  {/* Region centroids — soft colored discs in the background. */}
                  <g className="starmap-regions">
                    {STARMAP.regions.map((r) => (
                      <circle
                        key={r.id}
                        cx={r.centroid.x}
                        cy={r.centroid.y}
                        r={9}
                        fill="#1a1a22"
                        opacity={0.35}
                      />
                    ))}
                  </g>

                  {/* Active burn route — origin marker → fleet token → destination. */}
                  {burn && (
                    <>
                      <line
                        x1={burn.fromX} y1={burn.fromY}
                        x2={burn.toX} y2={burn.toY}
                        stroke="#4ade80"
                        strokeWidth={0.35}
                        strokeDasharray="0.8,0.8"
                        opacity={0.5}
                      />
                      <circle cx={burn.toX} cy={burn.toY} r={1.4}
                        fill="none" stroke="#4ade80" strokeWidth={0.4}
                      />
                    </>
                  )}

                  {/* Hover/planned preview burn line. */}
                  {previewTarget && fleetPos && (
                    <line
                      x1={fleetPos.x} y1={fleetPos.y}
                      x2={previewTarget.pos.x} y2={previewTarget.pos.y}
                      stroke={previewBlock.ok ? '#4ade80' : '#ef4444'}
                      strokeWidth={0.4}
                      strokeDasharray="1.5,1"
                      opacity={0.85}
                    />
                  )}

                  <g className="starmap-pois">
                    {orderedPois.map((p) => {
                      const isCurrent = p.id === dockedId
                      const isFocus =
                        (planned?.poi?.id === p.id) ||
                        (!planned && hoveredPos != null
                         && distancePos(hoveredPos, p.pos) <= POI_SNAP_RADIUS)
                      const fill = FACTION_COLOR[p.factionControlPre] ?? '#525252'
                      const baseR = p.procedural ? 1.4 : 2.5
                      return (
                        <g key={p.id} opacity={p.procedural ? 0.7 : 1}>
                          {isCurrent && !burning && (
                            <circle
                              cx={p.pos.x}
                              cy={p.pos.y}
                              r={3}
                              className="starmap-pulse"
                              fill="none"
                              stroke="#4ade80"
                              strokeWidth={0.6}
                            />
                          )}
                          <circle
                            cx={p.pos.x}
                            cy={p.pos.y}
                            r={baseR}
                            fill={fill}
                            stroke={isFocus ? '#e6e6ea' : '#0d0d10'}
                            strokeWidth={isFocus ? 0.6 : 0.35}
                            style={{ pointerEvents: 'none' }}
                          />
                          {!p.procedural && (
                            <text
                              x={p.pos.x}
                              y={p.pos.y + 5.5}
                              fontSize={2.4}
                              textAnchor="middle"
                              fill="#e6e6ea"
                              style={{ pointerEvents: 'none' }}
                            >
                              {p.shortZh ?? p.nameZh}
                            </text>
                          )}
                        </g>
                      )
                    })}
                  </g>

                  {/* Free-space planned target (when not snapped to a POI). */}
                  {planned && !planned.poi && (
                    <g style={{ pointerEvents: 'none' }}>
                      <circle cx={planned.pos.x} cy={planned.pos.y} r={1.2}
                        fill="none" stroke="#4ade80" strokeWidth={0.4}
                      />
                      <line
                        x1={planned.pos.x - 1.6} y1={planned.pos.y}
                        x2={planned.pos.x + 1.6} y2={planned.pos.y}
                        stroke="#4ade80" strokeWidth={0.3}
                      />
                      <line
                        x1={planned.pos.x} y1={planned.pos.y - 1.6}
                        x2={planned.pos.x} y2={planned.pos.y + 1.6}
                        stroke="#4ade80" strokeWidth={0.3}
                      />
                    </g>
                  )}

                  {/* Fleet token — always rendered so the player sees their
                      ship in 2D space, whether docked, burning, or drifting. */}
                  {fleetPos && (
                    <g style={{ pointerEvents: 'none' }}>
                      <circle
                        cx={fleetPos.x} cy={fleetPos.y} r={1.6}
                        fill="#fef9c3" stroke="#0d0d10" strokeWidth={0.4}
                      />
                      <circle
                        cx={fleetPos.x} cy={fleetPos.y} r={2.6}
                        fill="none" stroke="#fef9c3" strokeWidth={0.25}
                        opacity={burning ? 0.9 : 0.45}
                      />
                    </g>
                  )}
                </svg>
              </div>

              <aside className="starmap-info">
                {burning && burn ? (
                  <BurnProgressCard
                    destPoiName={
                      burn.destPoiId
                        ? (getPoi(burn.destPoiId)?.nameZh ?? '未知坐标')
                        : '空域坐标'
                    }
                    progress={getBurnProgress() ?? 0}
                    arriveAtMs={burn.arriveAtMs}
                  />
                ) : planned ? (
                  <PlannedBurnCard
                    target={planned}
                    cost={previewCost}
                    blockReason={previewBlock.ok ? null : (FAIL_HINT[previewBlock.reason!] ?? '不可航行')}
                    onConfirm={commitBurn}
                    onCancel={() => setPlanned(null)}
                  />
                ) : previewTarget ? (
                  <PoiInfoCard
                    target={previewTarget}
                    cost={previewCost}
                    isCurrent={previewTarget.poi?.id === dockedId}
                  />
                ) : (
                  <p className="map-place-desc">
                    点击地图任意位置来规划航行;靠近坐标会自动吸附到该坐标。
                  </p>
                )}
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function PoiInfoCard(props: {
  target: PlannedTarget
  cost: BurnCost | null
  isCurrent: boolean
}) {
  const { target, cost, isCurrent } = props
  if (!target.poi) {
    return (
      <div className="starmap-info-card">
        <div className="starmap-info-name">空域坐标</div>
        <div className="status-meta">未命名 · 无服务</div>
        {cost && (
          <p className="map-place-desc">
            航行 · 燃料 {cost.fuel} · 补给 {cost.supplies} · {formatDuration(cost.durationMin)}
          </p>
        )}
      </div>
    )
  }
  const poi = target.poi
  const region = getRegion(poi.region)
  return (
    <div className="starmap-info-card">
      <div className="starmap-info-name">
        {poi.nameZh}
        {isCurrent && <span className="map-place-here">当前</span>}
      </div>
      <div className="status-meta">
        {TYPE_LABEL[poi.type] ?? poi.type} · {FACTION_LABEL[poi.factionControlPre] ?? poi.factionControlPre}
        {region && ` · ${region.nameZh}`}
        {poi.procedural && ' · 临时坐标'}
      </div>
      {poi.services.length > 0 && (
        <div className="starmap-info-services">
          服务:{poi.services.map((s) => SERVICE_LABEL[s] ?? s).join(' · ')}
        </div>
      )}
      {poi.description && <p className="map-place-desc">{poi.description}</p>}
      {cost && !isCurrent && (
        <p className="map-place-desc">
          航行 · 燃料 {cost.fuel} · 补给 {cost.supplies} · {formatDuration(cost.durationMin)}
        </p>
      )}
    </div>
  )
}

function PlannedBurnCard(props: {
  target: PlannedTarget
  cost: BurnCost | null
  blockReason: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const { target, cost, blockReason, onConfirm, onCancel } = props
  const name = target.poi ? target.poi.nameZh : '空域坐标'
  const buttonLabel = cost
    ? `航行 · 燃料 ${cost.fuel} · 补给 ${cost.supplies} · ${formatDuration(cost.durationMin)}`
    : '航行'
  return (
    <div className="starmap-info-card">
      <div className="starmap-info-name">规划航行 → {name}</div>
      {target.poi && (
        <div className="status-meta">
          {TYPE_LABEL[target.poi.type] ?? target.poi.type} · {FACTION_LABEL[target.poi.factionControlPre]}
        </div>
      )}
      {!target.poi && (
        <div className="status-meta">坐标 ({target.pos.x.toFixed(1)}, {target.pos.y.toFixed(1)})</div>
      )}
      <button
        className="transit-terminal-go starmap-jump-btn"
        onClick={onConfirm}
        disabled={blockReason != null}
        title={blockReason ?? undefined}
      >
        {blockReason ?? buttonLabel}
      </button>
      <button
        className="status-close starmap-cancel-btn"
        onClick={onCancel}
        style={{ marginTop: 8 }}
      >
        取消
      </button>
    </div>
  )
}

function BurnProgressCard(props: {
  destPoiName: string
  progress: number
  arriveAtMs: number
}) {
  const { destPoiName, progress, arriveAtMs } = props
  const pct = Math.round(progress * 100)
  const arrivalDate = new Date(arriveAtMs)
  return (
    <div className="starmap-info-card">
      <div className="starmap-info-name">航行中 → {destPoiName}</div>
      <div className="starmap-progress">
        <div className="starmap-progress-bar" style={{ width: `${pct}%` }} />
      </div>
      <div className="status-meta">
        进度 {pct}% · 预计抵达 {arrivalDate.getHours().toString().padStart(2, '0')}:
        {arrivalDate.getMinutes().toString().padStart(2, '0')}
      </div>
      <p className="map-place-desc">
        舰队正在跨越空间。让游戏继续运行(可使用快进)以推进航程。
      </p>
    </div>
  )
}
