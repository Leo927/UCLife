import { useState, useMemo } from 'react'
import { useQueryFirst, useTrait } from 'koota/react'
import { IsPlayer, Ambitions, type AmbitionSlot } from '../ecs/traits'
import { ambitions, getAmbition, normalizeRequirement } from '../data/ambitions'
import { PERKS, getPerk } from '../data/perks'
import { useUI } from './uiStore'
import { useClock } from '../sim/clock'
import { readStageProgress } from '../systems/ambitions'
import { invalidatePerkCache } from '../systems/perkEffects'
import { useEventLog } from './EventLog'

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

const CATEGORY_LABEL: Record<string, string> = {
  vital: '生理',
  skill: '技能',
  social: '社交',
  economic: '经济',
  combat: '战斗',
  faction: '势力',
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

export function AmbitionPanel() {
  const open = useUI((s) => s.ambitionsOpen)
  const setOpen = useUI((s) => s.setAmbitions)
  const player = useQueryFirst(IsPlayer, Ambitions)
  const amb = useTrait(player, Ambitions)
  const gameMs = useClock((s) => s.gameDate.getTime())
  const logEntries = useEventLog((s) => s.entries)

  const forcePicker = !!amb && amb.active.length === 0
  const [pickerMode, setPickerMode] = useState(false)
  const [perkStoreMode, setPerkStoreMode] = useState(false)
  const inPicker = forcePicker || pickerMode

  if (!open && !forcePicker) return null
  if (!player || !amb) return null

  const activeIds = new Set(amb.active.map((s) => s.id))

  const close = () => {
    if (forcePicker) return
    setPickerMode(false)
    setPerkStoreMode(false)
    setOpen(false)
  }

  const onOverlayClick = () => {
    if (forcePicker) return
    close()
  }

  // ── PICKER MODE — pick any number, drop any number ────────────────
  // Per the Sims pivot, no cap on simultaneously-pursued ambitions and
  // conflicts surface as informational warnings, not blockers.
  const togglePursue = (id: string) => {
    const cur = amb.active.find((s) => s.id === id)
    if (cur) {
      // Drop. History records the partial progress.
      const next = amb.active.filter((s) => s.id !== id)
      const nextHistory = [...amb.history, {
        id, completedStages: cur.currentStage, droppedAtMs: gameMs,
      }]
      player.set(Ambitions, {
        active: next, history: nextHistory,
        apBalance: amb.apBalance, apEarned: amb.apEarned, perks: amb.perks,
      })
    } else {
      const slot: AmbitionSlot = { id, currentStage: 0, streakAnchorMs: null }
      player.set(Ambitions, {
        active: [...amb.active, slot], history: amb.history,
        apBalance: amb.apBalance, apEarned: amb.apEarned, perks: amb.perks,
      })
    }
  }

  if (inPicker) {
    const conflictIds = (id: string): string[] => {
      const def = getAmbition(id)
      if (!def) return []
      const out: string[] = []
      for (const a of amb.active) {
        if (a.id === id) continue
        const aDef = getAmbition(a.id)
        if (!aDef) continue
        if (def.conflicts.includes(a.id) || aDef.conflicts.includes(id)) {
          out.push(aDef.nameZh)
        }
      }
      return out
    }
    return (
      <div
        className="status-overlay"
        onClick={onOverlayClick}
        data-ambition-picker={forcePicker ? 'forced' : 'manage'}
      >
        <div className="status-panel" onClick={(e) => e.stopPropagation()}>
          <header className="status-header">
            <h2>{forcePicker ? '选择一个志向开始' : '管理志向'}</h2>
            {!forcePicker && (
              <button className="status-close" onClick={() => setPickerMode(false)} aria-label="关闭">✕</button>
            )}
          </header>
          <section className="status-section">
            <p className="status-meta">
              志向不是任务。可以同时追求任意个；冲突仅作提示。完成阶段获得志向点用于购买永久天赋。
            </p>
          </section>
          <section className="status-section">
            {ambitions.map((a) => {
              const isActive = activeIds.has(a.id)
              const conflicts = conflictIds(a.id)
              return (
                <div key={a.id} className="transit-terminal-row" data-ambition-id={a.id}>
                  <div className="transit-terminal-info">
                    <div className="transit-terminal-name">{a.nameZh}</div>
                    <p className="transit-terminal-desc">{a.blurbZh}</p>
                    {conflicts.length > 0 && (
                      <p className="transit-terminal-desc" style={{ color: 'var(--warn, #f59e0b)' }}>
                        提示:与已选志向冲突 ({conflicts.join('、')})
                      </p>
                    )}
                  </div>
                  <button
                    className="transit-terminal-go"
                    onClick={() => togglePursue(a.id)}
                    data-ambition-pick={isActive ? 'on' : 'off'}
                  >
                    {isActive ? '✓ 追求中' : '追求'}
                  </button>
                </div>
              )
            })}
          </section>
        </div>
      </div>
    )
  }

  // ── PERK STORE MODE ───────────────────────────────────────────────
  if (perkStoreMode) {
    const purchasedSet = new Set(amb.perks)

    const buyPerk = (perkId: string) => {
      if (purchasedSet.has(perkId)) return
      const def = getPerk(perkId)
      if (!def) return
      if (amb.apBalance < def.apCost) return
      player.set(Ambitions, {
        active: amb.active, history: amb.history,
        apBalance: amb.apBalance - def.apCost,
        apEarned: amb.apEarned,
        perks: [...amb.perks, perkId],
      })
      invalidatePerkCache()
    }

    const grouped = useMemo(() => {
      const out: Record<string, typeof PERKS[number][]> = {}
      for (const p of PERKS) {
        if (!out[p.category]) out[p.category] = []
        out[p.category].push(p)
      }
      return out
    }, [])
    void grouped  // memo deps stable; only PERKS used.

    return (
      <div className="status-overlay" onClick={onOverlayClick}>
        <div className="status-panel" onClick={(e) => e.stopPropagation()}>
          <header className="status-header">
            <h2>天赋商店</h2>
            <button className="status-close" onClick={() => setPerkStoreMode(false)} aria-label="关闭">✕</button>
          </header>
          <section className="status-section">
            <div className="status-meta">
              志向点 · 余额 {amb.apBalance} / 总计 {amb.apEarned}
            </div>
          </section>
          {Object.entries(grouped).map(([cat, list]) => (
            <section key={cat} className="status-section">
              <h3>{CATEGORY_LABEL[cat] ?? cat}</h3>
              {list.map((p) => {
                const owned = purchasedSet.has(p.id)
                const affordable = amb.apBalance >= p.apCost
                return (
                  <div key={p.id} className="transit-terminal-row" data-perk-id={p.id}>
                    <div className="transit-terminal-info">
                      <div className="transit-terminal-name">
                        {p.nameZh} <span className="status-meta">· {p.apCost} AP</span>
                      </div>
                      <p className="transit-terminal-desc">{p.descZh}</p>
                    </div>
                    <button
                      className="transit-terminal-go"
                      onClick={() => buyPerk(p.id)}
                      disabled={owned || !affordable}
                      data-perk-owned={owned ? 'true' : 'false'}
                    >
                      {owned ? '已拥有' : (affordable ? '购买' : '点数不足')}
                    </button>
                  </div>
                )
              })}
            </section>
          ))}
        </div>
      </div>
    )
  }

  // ── VIEW MODE ──────────────────────────────────────────────────────
  return (
    <div className="status-overlay" onClick={onOverlayClick}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>志向</h2>
          <button className="status-close" onClick={close} aria-label="关闭">✕</button>
        </header>
        <section className="status-section">
          <div className="status-meta">
            志向点 · 余额 {amb.apBalance} / 总计 {amb.apEarned} · 已购天赋 {amb.perks.length}
          </div>
        </section>
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
              <div className="status-meta">追求与放弃志向不再有冷却或上限。</div>
            </div>
            <button
              className="transit-terminal-go"
              onClick={() => setPickerMode(true)}
              data-ambition-manage
            >
              管理志向
            </button>
            <button
              className="transit-terminal-go"
              onClick={() => setPerkStoreMode(true)}
              data-perk-store
              style={{ marginLeft: 8 }}
            >
              天赋商店
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
