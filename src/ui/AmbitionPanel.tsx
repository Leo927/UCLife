import { useState, useMemo } from 'react'
import { useQueryFirst, useTrait } from 'koota/react'
import { IsPlayer, Ambitions, type AmbitionSlot } from '../ecs/traits'
import { ambitions, getAmbition, normalizeRequirement } from '../data/ambitions'
import { useUI } from './uiStore'
import { useClock } from '../sim/clock'
import { readStageProgress } from '../systems/ambitions'
import { useEventLog } from './EventLog'

const MS_PER_GAME_YEAR = 365 * 24 * 60 * 60 * 1000

const REQUIREMENT_LABELS: Record<string, string> = {
  strength: '力量',
  endurance: '耐力',
  charisma: '魅力',
  intelligence: '智力',
  reflex: '反应',
  resolve: '意志',
  mechanics: '机械',
  marksmanship: '枪法',
  athletics: '体力',
  cooking: '烹饪',
  medicine: '医学',
  computers: '计算机',
  piloting: '驾驶',
  bartending: '调酒',
  engineering: '工程',
  money: '存款',
  anaheim: 'AE 声望',
  civilian: '平民声望',
  federation: '联邦声望',
  zeon: '吉翁声望',
  aeRank: 'AE 职级',
  residenceTier: '居所等级',
  hasNoJob: '无业',
  hasNoHome: '无家',
  daysAtFlopWithNoJob: '潦倒天数',
}

function reqLabel(key: string): string {
  return REQUIREMENT_LABELS[key] ?? key
}

function formatThreshold(req: ReturnType<typeof normalizeRequirement>): string {
  if (req.gte !== undefined && req.lte !== undefined) {
    return `${req.gte}–${req.lte}`
  }
  if (req.lte !== undefined) return `≤ ${req.lte}`
  return `${req.gte ?? 0}`
}

function formatCooldownRemaining(deltaMs: number): string {
  const days = Math.ceil(deltaMs / (24 * 60 * 60 * 1000))
  if (days >= 30) {
    const months = Math.ceil(days / 30)
    return `还需 ${months} 个月`
  }
  return `还需 ${days} 天`
}

export function AmbitionPanel() {
  const open = useUI((s) => s.ambitionsOpen)
  const setOpen = useUI((s) => s.setAmbitions)
  const player = useQueryFirst(IsPlayer, Ambitions)
  const amb = useTrait(player, Ambitions)
  const gameMs = useClock((s) => s.gameDate.getTime())
  const logEntries = useEventLog((s) => s.entries)

  const forcePicker = !!amb && amb.active.length === 0
  const [pickerMode, setPickerMode] = useState(false)
  const inPicker = forcePicker || pickerMode

  const [selected, setSelected] = useState<string[]>([])

  if (!open && !forcePicker) return null
  if (!player || !amb) return null

  const close = () => {
    if (forcePicker) return
    setPickerMode(false)
    setSelected([])
    setOpen(false)
  }

  const onOverlayClick = () => {
    if (forcePicker) return
    close()
  }

  const swapDisabled = amb.lastSwapMs > 0 && (gameMs - amb.lastSwapMs) < MS_PER_GAME_YEAR
  const swapTitle = swapDisabled
    ? `更换志向冷却中 · ${formatCooldownRemaining(MS_PER_GAME_YEAR - (gameMs - amb.lastSwapMs))}`
    : undefined

  const selectionConflicts = (id: string): boolean => {
    if (selected.includes(id)) return false
    const def = getAmbition(id)
    if (!def) return false
    for (const s of selected) {
      const sDef = getAmbition(s)
      if (!sDef) continue
      if (def.conflicts.includes(s) || sDef.conflicts.includes(id)) return true
    }
    return false
  }

  const togglePick = (id: string) => {
    setSelected((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id)
      if (cur.length >= 2) return cur
      if (selectionConflicts(id)) return cur
      return [...cur, id]
    })
  }

  const confirmPick = () => {
    if (selected.length !== 2) return
    const wasFirstPick = amb.active.length === 0
    const replaced = amb.active.filter((s) => !selected.includes(s.id))
    const nextHistory = [...amb.history]
    for (const r of replaced) {
      nextHistory.push({ id: r.id, completedStages: r.currentStage, droppedAtMs: gameMs })
    }
    const nextActive: AmbitionSlot[] = selected.map((id) => {
      const existing = amb.active.find((s) => s.id === id)
      if (existing) return existing
      return { id, currentStage: 0, streakAnchorMs: null }
    })
    player.set(Ambitions, {
      active: nextActive,
      history: nextHistory,
      // First-time pick is not a "swap" — leave cooldown unstarted.
      lastSwapMs: wasFirstPick ? 0 : gameMs,
    })
    setSelected([])
    setPickerMode(false)
    if (forcePicker) {
      // forced-picker dismisses by becoming non-empty.
    }
  }

  // ── PICKER MODE ────────────────────────────────────────────────────────
  if (inPicker) {
    return (
      <div
        className="status-overlay"
        onClick={onOverlayClick}
        data-ambition-picker={forcePicker ? 'forced' : 'swap'}
      >
        <div className="status-panel" onClick={(e) => e.stopPropagation()}>
          <header className="status-header">
            <h2>{forcePicker ? '选择两个志向' : '更换志向'}</h2>
            {!forcePicker && (
              <button className="status-close" onClick={() => setPickerMode(false)} aria-label="关闭">✕</button>
            )}
          </header>
          <section className="status-section">
            <p className="status-meta">
              志向不是任务。它告诉你想要什么；做不做、怎么做，由你。需选两个。
            </p>
          </section>
          <section className="status-section">
            {ambitions.map((a) => {
              const picked = selected.includes(a.id)
              const conflict = selectionConflicts(a.id)
              const disabled = !picked && (selected.length >= 2 || conflict)
              return (
                <div key={a.id} className="transit-terminal-row" data-ambition-id={a.id}>
                  <div className="transit-terminal-info">
                    <div className="transit-terminal-name">{a.nameZh}</div>
                    <p className="transit-terminal-desc">{a.blurbZh}</p>
                    {conflict && (
                      <p className="transit-terminal-desc" style={{ color: 'var(--danger, #ef4444)' }}>
                        与已选志向冲突
                      </p>
                    )}
                  </div>
                  <button
                    className="transit-terminal-go"
                    onClick={() => togglePick(a.id)}
                    disabled={disabled}
                    title={conflict ? '与已选志向冲突' : undefined}
                    data-ambition-pick={picked ? 'on' : 'off'}
                  >
                    {picked ? '✓ 已选' : '选定'}
                  </button>
                </div>
              )
            })}
          </section>
          <section className="status-section">
            <div className="transit-terminal-row">
              <div className="transit-terminal-info">
                <div className="status-meta">已选 {selected.length} / 2</div>
              </div>
              <button
                className="transit-terminal-go"
                onClick={confirmPick}
                disabled={selected.length !== 2}
                data-ambition-confirm
              >
                确认
              </button>
            </div>
          </section>
        </div>
      </div>
    )
  }

  // ── VIEW MODE ──────────────────────────────────────────────────────────
  return (
    <div className="status-overlay" onClick={onOverlayClick}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>志向</h2>
          <button className="status-close" onClick={close} aria-label="关闭">✕</button>
        </header>
        {amb.active.map((slot) => {
          const def = getAmbition(slot.id)
          if (!def) return null
          const stage = def.stages[slot.currentStage]
          const completed = slot.currentStage
          const total = def.stages.length
          const progress = stage ? readStageProgress(player, slot, gameMs) : []
          const completedTitles = def.stages
            .slice(0, completed)
            .map((s) => s.payoff.titleZh)
          return (
            <section key={slot.id} className="status-section" data-ambition-active={slot.id}>
              <h3>{def.nameZh}</h3>
              <div className="status-meta">
                {stage
                  ? `第 ${slot.currentStage + 1} / ${total} 阶段 · ${stage.stageNameZh}`
                  : `已完成全部 ${total} 阶段`}
              </div>
              {stage && progress.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {progress.map((p) => {
                    const norm = normalizeRequirement(p.requirement)
                    const target = norm.gte ?? norm.lte ?? 1
                    const fillPct = Math.max(0, Math.min(100, Math.round((p.current / Math.max(target, 1)) * 100)))
                    return (
                      <div key={p.key} className="status-bar-row">
                        <span className="status-bar-label">{reqLabel(p.key)}</span>
                        <div className="status-bar-track">
                          <div
                            className="status-bar-fill"
                            style={{
                              width: `${fillPct}%`,
                              background: p.satisfied ? '#4ade80' : '#8a8a94',
                            }}
                          />
                        </div>
                        <span className="status-bar-num">
                          {p.current} / {formatThreshold(norm)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
              {completedTitles.length > 0 && (
                <div className="status-meta" style={{ marginTop: 8, opacity: 0.7 }}>
                  已完成: {completedTitles.join(' · ')}
                </div>
              )}
            </section>
          )
        })}
        <section className="status-section">
          <div className="transit-terminal-row">
            <div className="transit-terminal-info">
              <div className="status-meta">每年最多更换一次。换志向会丢失被换出那个的进度。</div>
            </div>
            <button
              className="transit-terminal-go"
              onClick={() => setPickerMode(true)}
              disabled={swapDisabled}
              title={swapTitle}
              data-ambition-swap
            >
              更换志向
            </button>
          </div>
        </section>
        <section className="status-section">
          <h3>近期记录</h3>
          {logEntries.length === 0 ? (
            <p className="status-muted">尚无</p>
          ) : (
            <RecentLog />
          )}
        </section>
      </div>
    </div>
  )
}

function RecentLog() {
  const entries = useEventLog((s) => s.entries)
  const recent = useMemo(() => entries.slice(-10).reverse(), [entries])
  return (
    <div>
      {recent.map((e) => (
        <div key={e.id} className="status-meta" style={{ marginTop: 4 }} data-event-log-line>
          {e.textZh}
        </div>
      ))}
    </div>
  )
}
