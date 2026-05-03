import { useEffect, useMemo, useState } from 'react'
import { useUI } from './uiStore'
import { STARMAP, getNode, neighborsOf, type FactionKey, type StarmapNode } from '../data/starmap'
import { getShipState, getDockedNodeId } from '../sim/ship'
import { useTransition } from '../sim/transition'
import { jumpTo, canJumpTo } from '../systems/starmap'

const FACTION_COLOR: Record<FactionKey, string> = {
  civilian: '#94a3b8',
  efsf: '#3b82f6',
  ae: '#f59e0b',
  zeon: '#dc2626',
  pirate: '#7c3aed',
  neutral: '#a3a3a3',
  none: '#525252',
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
}

function formatDuration(min: number): string {
  if (min < 60) return `${min} 分钟`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (m === 0) return `${h} 小时`
  return `${h} 小时 ${m} 分钟`
}

const FAIL_HINT: Record<string, string> = {
  'no-ship': '没有飞船',
  'not-docked': '飞船未在节点',
  'not-neighbor': '该节点不在跳跃范围内',
  'insufficient-fuel': '燃料不足',
  'in-transition': '正在跳跃中',
}

export function StarmapPanel() {
  const open = useUI((s) => s.starmapOpen)
  const setStarmap = useUI((s) => s.setStarmap)
  const inTransition = useTransition((s) => s.inProgress)
  // After a jump completes, transition.inProgress flips false — we use
  // that to bump a revision and re-read getShipState() (which is ECS-backed,
  // not zustand-subscribed).
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!inTransition) setRevision((r) => r + 1)
  }, [inTransition])

  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const ship = open ? getShipState() : null
  const dockedId = open ? getDockedNodeId() : null
  // Bust memoization on revision so the SVG redraws when the ship moves.
  const neighborSet = useMemo(() => {
    if (!dockedId) return new Set<string>()
    return new Set(neighborsOf(dockedId).map((n) => n.node.id))
  }, [dockedId, revision])

  if (!open) return null

  const close = () => {
    setStarmap(false)
    setHoveredId(null)
    setSelectedId(null)
  }

  const dockedNode = dockedId ? getNode(dockedId) ?? null : null
  const focusId = hoveredId ?? selectedId ?? dockedId ?? null
  const focusNode = focusId ? getNode(focusId) ?? null : null
  const focusEdge = focusId && dockedId && focusId !== dockedId
    ? neighborsOf(dockedId).find((n) => n.node.id === focusId)?.edge ?? null
    : null

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
          <h2>星图</h2>
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
                <span>当前位置 · {dockedNode ? dockedNode.nameZh : '航行中'}</span>
                <span>燃料 {ship.fuelCurrent}/{ship.fuelMax}</span>
                <span>装甲 {ship.hullCurrent}/{ship.hullMax}</span>
              </div>
            </section>

            <div className="starmap-body">
              <div className="starmap-graph">
                <svg
                  viewBox="0 0 100 100"
                  className="starmap-svg"
                  preserveAspectRatio="xMidYMid meet"
                >
                  <g className="starmap-edges">
                    {STARMAP.edges.map((e) => {
                      const a = getNode(e.from)
                      const b = getNode(e.to)
                      if (!a || !b) return null
                      const reachable =
                        dockedId !== null &&
                        ((e.from === dockedId && neighborSet.has(e.to)) ||
                          (e.to === dockedId && neighborSet.has(e.from)))
                      return (
                        <line
                          key={`${e.from}->${e.to}`}
                          x1={a.mapPos.x}
                          y1={a.mapPos.y}
                          x2={b.mapPos.x}
                          y2={b.mapPos.y}
                          stroke={reachable ? '#4ade80' : '#3a3a44'}
                          strokeWidth={reachable ? 0.4 : 0.25}
                          strokeDasharray={e.inSectorOnly ? undefined : '1.5,1'}
                          opacity={reachable ? 0.9 : 0.5}
                        />
                      )
                    })}
                  </g>

                  <g className="starmap-nodes">
                    {STARMAP.nodes.map((n) => {
                      const isCurrent = n.id === dockedId
                      const isReachable = neighborSet.has(n.id)
                      const isFocus = n.id === focusId
                      const dim = !isCurrent && !isReachable
                      const fill = FACTION_COLOR[n.factionControlPre] ?? '#525252'
                      return (
                        <g
                          key={n.id}
                          opacity={dim ? 0.4 : 1}
                          style={{
                            cursor: isReachable ? 'pointer' : 'default',
                          }}
                          onMouseEnter={() => setHoveredId(n.id)}
                          onMouseLeave={() => setHoveredId(null)}
                          onClick={() => {
                            if (isReachable) setSelectedId(n.id)
                          }}
                        >
                          {isCurrent && (
                            <circle
                              cx={n.mapPos.x}
                              cy={n.mapPos.y}
                              r={3}
                              className="starmap-pulse"
                              fill="none"
                              stroke="#4ade80"
                              strokeWidth={0.6}
                            />
                          )}
                          <circle
                            cx={n.mapPos.x}
                            cy={n.mapPos.y}
                            r={2.5}
                            fill={fill}
                            stroke={isFocus ? '#e6e6ea' : '#0d0d10'}
                            strokeWidth={isFocus ? 0.6 : 0.35}
                          />
                          <text
                            x={n.mapPos.x}
                            y={n.mapPos.y + 5.5}
                            fontSize={2.4}
                            textAnchor="middle"
                            fill={dim ? '#6a6a72' : '#e6e6ea'}
                            style={{ pointerEvents: 'none' }}
                          >
                            {n.shortZh ?? n.nameZh}
                          </text>
                        </g>
                      )
                    })}
                  </g>
                </svg>
              </div>

              <aside className="starmap-info">
                {focusNode ? (
                  <NodeInfoCard
                    node={focusNode}
                    isCurrent={focusNode.id === dockedId}
                    edgeFuel={focusEdge?.fuelCost}
                    edgeDuration={focusEdge?.durationMin}
                    onJump={() => jumpTo(focusNode.id)}
                    disabledReason={
                      focusNode.id === dockedId
                        ? '已在此节点'
                        : (() => {
                            const r = canJumpTo(focusNode.id)
                            if (r.ok) return null
                            return FAIL_HINT[r.reason!] ?? '不可跳跃'
                          })()
                    }
                  />
                ) : (
                  <p className="map-place-desc">悬停或点击节点查看详情。</p>
                )}
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function NodeInfoCard(props: {
  node: StarmapNode
  isCurrent: boolean
  edgeFuel?: number
  edgeDuration?: number
  onJump: () => void
  disabledReason: string | null
}) {
  const { node, isCurrent, edgeFuel, edgeDuration, onJump, disabledReason } = props
  const sector = STARMAP.sectors.find((s) => s.id === node.sectorId)
  const factionLabel: Record<FactionKey, string> = {
    civilian: '民用',
    efsf: '联邦军',
    ae: 'AE',
    zeon: '吉翁',
    pirate: '海盗',
    neutral: '中立',
    none: '无主',
  }
  const canShowJump = !isCurrent && edgeFuel != null && edgeDuration != null
  const buttonLabel = canShowJump
    ? `跳跃 · 燃料 ${edgeFuel} · 时间 ${formatDuration(edgeDuration)}`
    : '跳跃'

  return (
    <div className="starmap-info-card">
      <div className="starmap-info-name">
        {node.nameZh}
        {isCurrent && <span className="map-place-here">当前</span>}
      </div>
      <div className="status-meta">
        {sector?.nameZh ?? node.sectorId} · {TYPE_LABEL[node.type] ?? node.type} · {factionLabel[node.factionControlPre] ?? node.factionControlPre}
      </div>
      {node.services.length > 0 && (
        <div className="starmap-info-services">
          服务:{node.services.map((s) => SERVICE_LABEL[s] ?? s).join(' · ')}
        </div>
      )}
      {node.description && (
        <p className="map-place-desc">{node.description}</p>
      )}
      <button
        className="transit-terminal-go starmap-jump-btn"
        onClick={onJump}
        disabled={disabledReason != null}
        title={disabledReason ?? undefined}
      >
        {disabledReason ?? buttonLabel}
      </button>
    </div>
  )
}
