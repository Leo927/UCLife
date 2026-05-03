import { useEffect, useState } from 'react'
import { useUI } from './uiStore'
import {
  STARMAP, getPoi, burnCost, type FactionKey, type Poi,
} from '../data/starmap'
import { getShipState, getDockedPoiId } from '../sim/ship'
import { useTransition } from '../sim/transition'
import { burnTo, canBurnTo } from '../systems/starmap'

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
  'not-docked': '飞船未在停靠点',
  'unknown-poi': '未知坐标',
  'insufficient-fuel': '燃料不足',
  'insufficient-supplies': '补给不足',
  'in-transition': '正在航行中',
  'same-poi': '已在此处',
}

function formatDuration(min: number): string {
  if (min < 60) return `${min} 分钟`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (m === 0) return `${h} 小时`
  return `${h} 小时 ${m} 分钟`
}

export function StarmapPanel() {
  const open = useUI((s) => s.starmapOpen)
  const setStarmap = useUI((s) => s.setStarmap)
  const inTransition = useTransition((s) => s.inProgress)
  // Bump on transition completion so the panel re-reads ship state.
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!inTransition) setRevision((r) => r + 1)
  }, [inTransition])
  void revision

  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  if (!open) return null

  const ship = getShipState()
  const dockedId = getDockedPoiId()

  const close = () => {
    setStarmap(false)
    setHoveredId(null)
    setSelectedId(null)
  }

  const dockedPoi = dockedId ? getPoi(dockedId) ?? null : null
  const focusId = hoveredId ?? selectedId ?? dockedId ?? null
  const focusPoi = focusId ? getPoi(focusId) ?? null : null
  const focusCost = (focusId && dockedId && focusId !== dockedId)
    ? burnCost(dockedId, focusId)
    : null

  // Sort majors first, procedural last — keeps the labeled UC POIs
  // visually dominant while the seeded minor scatter sits in the
  // background.
  const orderedPois = [...STARMAP.pois].sort((a, b) => {
    if (!!a.procedural === !!b.procedural) return 0
    return a.procedural ? 1 : -1
  })

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
                <span>当前位置 · {dockedPoi ? dockedPoi.nameZh : '航行中'}</span>
                <span>燃料 {ship.fuelCurrent}/{ship.fuelMax}</span>
                <span>补给 {ship.suppliesCurrent}/{ship.suppliesMax}</span>
                <span>装甲 {Math.round(ship.armorCurrent)}/{ship.armorMax}</span>
                <span>船体 {Math.round(ship.hullCurrent)}/{ship.hullMax}</span>
              </div>
            </section>

            <div className="starmap-body">
              <div className="starmap-graph">
                <svg
                  viewBox="0 0 100 100"
                  className="starmap-svg"
                  preserveAspectRatio="xMidYMid meet"
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

                  {/* Selected/destination route line drawn from the docked POI. */}
                  {dockedPoi && focusPoi && focusPoi.id !== dockedPoi.id && (
                    <line
                      x1={dockedPoi.pos.x}
                      y1={dockedPoi.pos.y}
                      x2={focusPoi.pos.x}
                      y2={focusPoi.pos.y}
                      stroke="#4ade80"
                      strokeWidth={0.4}
                      strokeDasharray="1.5,1"
                      opacity={0.8}
                    />
                  )}

                  <g className="starmap-pois">
                    {orderedPois.map((p) => {
                      const isCurrent = p.id === dockedId
                      const isFocus = p.id === focusId
                      const fill = FACTION_COLOR[p.factionControlPre] ?? '#525252'
                      const baseR = p.procedural ? 1.4 : 2.5
                      return (
                        <g
                          key={p.id}
                          opacity={p.procedural ? 0.7 : 1}
                          style={{ cursor: 'pointer' }}
                          onMouseEnter={() => setHoveredId(p.id)}
                          onMouseLeave={() => setHoveredId(null)}
                          onClick={() => setSelectedId(p.id)}
                        >
                          {isCurrent && (
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
                </svg>
              </div>

              <aside className="starmap-info">
                {focusPoi ? (
                  <PoiInfoCard
                    poi={focusPoi}
                    isCurrent={focusPoi.id === dockedId}
                    cost={focusCost}
                    onBurn={() => burnTo(focusPoi.id)}
                    disabledReason={
                      focusPoi.id === dockedId
                        ? '已在此处'
                        : (() => {
                            const r = canBurnTo(focusPoi.id)
                            if (r.ok) return null
                            return FAIL_HINT[r.reason!] ?? '不可航行'
                          })()
                    }
                  />
                ) : (
                  <p className="map-place-desc">悬停或点击坐标查看详情。</p>
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
  poi: Poi
  isCurrent: boolean
  cost: { fuel: number; supplies: number; durationMin: number; distance: number } | null
  onBurn: () => void
  disabledReason: string | null
}) {
  const { poi, isCurrent, cost, onBurn, disabledReason } = props
  const buttonLabel = cost
    ? `航行 · 燃料 ${cost.fuel} · 补给 ${cost.supplies} · 时间 ${formatDuration(cost.durationMin)}`
    : '航行'

  return (
    <div className="starmap-info-card">
      <div className="starmap-info-name">
        {poi.nameZh}
        {isCurrent && <span className="map-place-here">当前</span>}
      </div>
      <div className="status-meta">
        {TYPE_LABEL[poi.type] ?? poi.type} · {FACTION_LABEL[poi.factionControlPre] ?? poi.factionControlPre}
        {poi.procedural && ' · 临时坐标'}
      </div>
      {poi.services.length > 0 && (
        <div className="starmap-info-services">
          服务:{poi.services.map((s) => SERVICE_LABEL[s] ?? s).join(' · ')}
        </div>
      )}
      {poi.description && (
        <p className="map-place-desc">{poi.description}</p>
      )}
      <button
        className="transit-terminal-go starmap-jump-btn"
        onClick={onBurn}
        disabled={disabledReason != null}
        title={disabledReason ?? undefined}
      >
        {disabledReason ?? buttonLabel}
      </button>
    </div>
  )
}
