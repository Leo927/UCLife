import { useQueryFirst, useTrait } from 'koota/react'
import { IsPlayer, Vitals, Health, Money, Skills, Inventory, Action, Job, Home, JobPerformance, Workstation, Bed, Attributes, Position, MoveTarget, QueuedInteract, Reputation, Character } from '../ecs/traits'
import { Portrait } from '../render/portrait/react/Portrait'
import type { BedTier } from '../ecs/traits'
import { useUI } from './uiStore'
import { useClock } from '../sim/clock'
import { SKILL_ORDER, SKILLS, levelOf, progressInLevel, BOOK_CAP_XP } from '../data/skills'
import { READING_DURATION_MIN, EATING_DURATION_MIN, DRINKING_DURATION_MIN } from '../data/actions'
import { dowLabel, getJobSpec } from '../data/jobs'
import { STAT_ORDER, STATS } from '../data/stats'
import { attributesConfig, jobsConfig } from '../config'
import { tierOf as factionTierOf, factionMeta, type FactionId } from '../data/factions'

const TIER_LABEL: Record<BedTier, string> = {
  flop: '投币床',
  dorm: '宿舍床',
  apartment: '公寓',
  luxury: '高级公寓',
  lounge: '员工沙发',
}

export function StatusPanel() {
  const open = useUI((s) => s.statusOpen)
  const setOpen = useUI((s) => s.setStatus)
  const player = useQueryFirst(IsPlayer, Vitals, Health)
  const vitals = useTrait(player, Vitals)
  const health = useTrait(player, Health)
  const money = useTrait(player, Money)
  const skills = useTrait(player, Skills)
  const inventory = useTrait(player, Inventory)
  const action = useTrait(player, Action)
  const job = useTrait(player, Job)
  const wsTrait = job?.workstation?.get(Workstation) ?? null
  const currentJob = wsTrait ? getJobSpec(wsTrait.specId) : null
  const home = useTrait(player, Home)
  const homeBedEnt = home?.bed ?? null
  const homeBed = useTrait(homeBedEnt, Bed)
  const homeBedPos = useTrait(homeBedEnt, Position)
  const perfTrait = useTrait(player, JobPerformance)
  const attrs = useTrait(player, Attributes)
  const reputation = useTrait(player, Reputation)
  const character = useTrait(player, Character)
  // Subscribe to gameDate so the rent countdown ticks live.
  const gameMs = useClock((s) => s.gameDate.getTime())

  if (!open) return null

  const canRead = action?.kind === 'idle' && (inventory?.books ?? 0) > 0
  const startReading = () => {
    if (!player || !canRead) return
    player.set(Action, { kind: 'reading', remaining: READING_DURATION_MIN, total: READING_DURATION_MIN })
    setOpen(false)
  }

  const isBusyAction = action && action.kind !== 'idle' && action.kind !== 'walking' && action.kind !== 'working'

  const drinkWater = () => {
    if (!player || !inventory || inventory.water === 0) return
    if (isBusyAction) return
    player.set(Action, { kind: 'drinking', remaining: DRINKING_DURATION_MIN, total: DRINKING_DURATION_MIN })
    setOpen(false)
  }

  const eatMeal = () => {
    if (!player || !inventory || inventory.meal === 0) return
    if (isBusyAction) return
    player.set(Action, { kind: 'eating', remaining: EATING_DURATION_MIN, total: EATING_DURATION_MIN })
    setOpen(false)
  }

  // Same `eating` action as basic meal — actionSystem consumes premium first
  // when available, so the path is unified for player + NPC.
  const eatPremiumMeal = () => {
    if (!player || !inventory || inventory.premiumMeal === 0) return
    if (isBusyAction) return
    player.set(Action, { kind: 'eating', remaining: EATING_DURATION_MIN, total: EATING_DURATION_MIN })
    setOpen(false)
  }

  // No QueuedInteract — the player might just want to check on their home;
  // if they want to rent/sleep they can click the bed.
  const walkHome = () => {
    if (!player || !homeBedPos) return
    player.set(MoveTarget, { x: homeBedPos.x, y: homeBedPos.y })
    if (player.has(QueuedInteract)) player.remove(QueuedInteract)
    setOpen(false)
  }

  const hasInv = inventory && (inventory.water > 0 || inventory.meal > 0 || inventory.premiumMeal > 0 || inventory.books > 0)

  return (
    <div className="status-overlay" onClick={() => setOpen(false)}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>状态</h2>
          <button className="status-close" onClick={() => setOpen(false)} aria-label="关闭">✕</button>
        </header>

        <section className="status-section status-identity">
          {player && (
            <div className="status-identity-portrait">
              <Portrait entity={player} renderer="revamp" width={96} height={128} />
            </div>
          )}
          <div className="status-identity-text">
            <div className="status-name">{character?.name || '新人'}</div>
            {character?.title && (
              <div className="status-meta status-title" data-player-title>{character.title}</div>
            )}
            <div className="status-meta">月面市民 · 冯·布劳恩 · UC 0077</div>
          </div>
        </section>

        <section className="status-section">
          <h3>金钱</h3>
          <div className="status-money">¥{money?.amount ?? 0}</div>
        </section>

        <section className="status-section">
          <h3>工作</h3>
          {currentJob ? (
            <>
              <div className="status-job">
                <span className="status-job-name">{currentJob.jobTitle}</span>
                <span className="status-job-wage">¥{currentJob.wage} / 班</span>
              </div>
              {currentJob.family && currentJob.employer && typeof currentJob.rank === 'number' && (
                <div className="status-meta" style={{ marginTop: 4 }}>
                  <span style={{ color: factionMeta(currentJob.employer as FactionId)?.accentColor ?? '#aaa' }}>
                    ● {factionMeta(currentJob.employer as FactionId)?.nameZh ?? currentJob.employer}
                  </span>
                  {' · 第 '}{currentJob.rank}{' 级 / 共 '}{familyMaxRank(currentJob.family)}{' 级'}
                </div>
              )}
              <div className="status-meta" style={{ marginTop: 4 }}>
                上班时间: {currentJob.workDays.length === 7 ? '每天' : currentJob.workDays.map(dowLabel).join('/')} {currentJob.shiftStart}:00 – {currentJob.shiftEnd}:00
              </div>
              <div className="status-bar-row" style={{ marginTop: 8 }}>
                <span className="status-bar-label">今日绩效</span>
                <div className="status-bar-track">
                  <div
                    className="status-bar-fill"
                    style={{
                      width: `${Math.round(perfTrait?.todayPerf ?? 0)}%`,
                      background: perfMeterColor(perfTrait?.todayPerf ?? 0),
                    }}
                  />
                </div>
                <span className="status-bar-num">{Math.round(perfTrait?.todayPerf ?? 0)}%</span>
              </div>
            </>
          ) : (
            <p className="status-muted">尚未受雇 · 前往市民人事局</p>
          )}
        </section>

        <section className="status-section">
          <h3>住所</h3>
          {homeBed ? (
            <>
              <div className="status-job">
                <button
                  type="button"
                  className="status-link"
                  onClick={walkHome}
                  disabled={!homeBedPos}
                  title="走向住所"
                >
                  {TIER_LABEL[homeBed.tier as BedTier]}
                </button>
                <span className="req-met">{homeBed.owned ? '已购入' : '已租下'}</span>
              </div>
              {homeBed.owned ? (
                <div className="status-meta" style={{ marginTop: 4 }}>
                  自有物业 · 永久产权 · 无需续租
                </div>
              ) : (
                <>
                  <div className="status-meta" style={{ marginTop: 4 }}>
                    租金: ¥{homeBed.nightlyRent} / {rentPeriodLabel(homeBed.tier as BedTier)}
                  </div>
                  {homeBed.rentPaidUntilMs > 0 && (
                    <div className="status-meta" style={{ marginTop: 2 }}>
                      {homeBed.tier === 'flop' ? '到期' : '下次缴租'}: {formatRentExpiry(homeBed.rentPaidUntilMs)} · {countdownLabel(homeBed.rentPaidUntilMs - gameMs)}
                    </div>
                  )}
                  {homeBed.tier !== 'flop' && (
                    <div className="status-meta" style={{ marginTop: 2 }}>
                      续租金额: ¥{homeBed.nightlyRent}
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <p className="status-muted">无固定住所 · 前往房产中介租房</p>
          )}
        </section>

        <section className="status-section">
          <h3>生命</h3>
          {health && <StatusBar label="健康" value={health.hp} invert />}
        </section>

        <section className="status-section">
          <h3>生理</h3>
          {vitals && (
            <>
              <StatusBar label="饥饿" value={vitals.hunger} />
              <StatusBar label="口渴" value={vitals.thirst} />
              <StatusBar label="疲劳" value={vitals.fatigue} />
              <StatusBar label="清洁" value={vitals.hygiene} />
              <StatusBar label="烦闷" value={vitals.boredom} />
            </>
          )}
        </section>

        <section className="status-section">
          <h3>属性</h3>
          {attrs && STAT_ORDER.map((id) => (
            <StatRow key={id} label={STATS[id].label} value={attrs[id].value} />
          ))}
        </section>

        <section className="status-section">
          <h3>技能</h3>
          {skills && SKILL_ORDER.map((id) => {
            const xp = skills[id]
            const lvl = levelOf(xp)
            const prog = progressInLevel(xp)
            const meta = SKILLS[id]
            const atBookCap = xp >= BOOK_CAP_XP
            return (
              <div key={id} className="skill-row">
                <span className="skill-name">{meta.label}</span>
                <span className="skill-level">Lv {lvl}</span>
                <div className="skill-track">
                  <div className="skill-fill" style={{ width: `${prog * 100}%` }} />
                </div>
                <span className="skill-cap" title="书籍封顶">{atBookCap ? '书读尽' : ''}</span>
              </div>
            )
          })}
        </section>

        <section className="status-section">
          <h3>物品</h3>
          {!hasInv && <p className="status-muted">暂无物品</p>}
          {inventory && inventory.water > 0 && (
            <div className="inv-row">
              <span className="inv-name">矿泉水 × {inventory.water}</span>
              <button className="inv-action" onClick={drinkWater} disabled={isBusyAction}>饮用 (1分钟)</button>
            </div>
          )}
          {inventory && inventory.meal > 0 && (
            <div className="inv-row">
              <span className="inv-name">简餐 × {inventory.meal}</span>
              <button className="inv-action" onClick={eatMeal} disabled={isBusyAction}>食用 (10分钟)</button>
            </div>
          )}
          {inventory && inventory.premiumMeal > 0 && (
            <div className="inv-row">
              <span className="inv-name">套餐 × {inventory.premiumMeal}</span>
              <button className="inv-action" onClick={eatPremiumMeal} disabled={isBusyAction}>食用 (10分钟)</button>
            </div>
          )}
          {inventory && inventory.books > 0 && (
            <div className="inv-row">
              <span className="inv-name">机械原理 × {inventory.books}</span>
              <button className="inv-action" onClick={startReading} disabled={!canRead}>
                阅读 (2小时)
              </button>
            </div>
          )}
        </section>

        <section className="status-section">
          <h3>声望</h3>
          {reputation && Object.keys(reputation.rep).length > 0 ? (
            Object.entries(reputation.rep).map(([fid, value]) => {
              const meta = factionMeta(fid as FactionId)
              if (!meta) return null
              const grade = factionTierOf(value ?? 0)
              return (
                <div key={fid} className="status-bar-row">
                  <span className="status-bar-label">
                    <span style={{ color: meta.accentColor }}>● </span>{meta.nameZh}
                  </span>
                  <span className="stat-grade" style={{ color: meta.accentColor }}>{grade}</span>
                </div>
              )
            })
          ) : (
            <p className="status-muted">尚未与任何派系建立关系</p>
          )}
        </section>

        <section className="status-section faded">
          <h3>人际关系</h3>
          <p>Phase 3 解锁</p>
        </section>

        <section className="status-section faded">
          <h3>近期记录</h3>
          <p>Phase 3 解锁</p>
        </section>
      </div>
    </div>
  )
}

function familyMaxRank(family: string): number {
  let max = 0
  for (const spec of Object.values(jobsConfig.catalog)) {
    if (spec.family === family && typeof spec.rank === 'number' && spec.rank > max) max = spec.rank
  }
  return max
}

// Wide bands on purpose — player sees rough trend, not min-max fodder.
function gradeOf(value: number): 'S' | 'A' | 'B' | 'C' | 'D' | 'E' {
  const t = attributesConfig.gradeThresholds
  if (value >= t.S) return 'S'
  if (value >= t.A) return 'A'
  if (value >= t.B) return 'B'
  if (value >= t.C) return 'C'
  if (value >= t.D) return 'D'
  return 'E'
}

function StatRow({ label, value }: { label: string; value: number }) {
  const grade = gradeOf(value)
  return (
    <div className="status-bar-row">
      <span className="status-bar-label">{label}</span>
      <span className="stat-grade" style={{ color: attributesConfig.gradeColors[grade] }}>{grade}</span>
    </div>
  )
}

function StatusBar({ label, value, invert = false }: { label: string; value: number; invert?: boolean }) {
  const filled = Math.max(0, Math.min(100, value))
  const goodness = invert ? filled : 100 - filled
  const color = goodness > 60 ? '#4ade80' : goodness > 30 ? '#facc15' : '#ef4444'
  const desc = describe(value, invert)
  return (
    <div className="status-bar-row">
      <span className="status-bar-label">{label}</span>
      <div className="status-bar-track">
        <div className="status-bar-fill" style={{ width: `${filled}%`, background: color }} />
      </div>
      <span className="status-bar-desc" style={{ color }}>{desc}</span>
      <span className="status-bar-num">{Math.round(filled)}</span>
    </div>
  )
}

function formatRentExpiry(ms: number): string {
  const d = new Date(ms)
  const yyyy = d.getFullYear().toString().padStart(4, '0')
  const mm = (d.getMonth() + 1).toString().padStart(2, '0')
  const dd = d.getDate().toString().padStart(2, '0')
  const hh = d.getHours().toString().padStart(2, '0')
  const mn = d.getMinutes().toString().padStart(2, '0')
  return `UC ${yyyy}.${mm}.${dd} ${hh}:${mn}`
}

function rentPeriodLabel(tier: BedTier): string {
  return tier === 'flop' ? '12小时' : '月'
}

function countdownLabel(deltaMs: number): string {
  if (deltaMs <= 0) return '已到期'
  const minutes = Math.floor(deltaMs / 60000)
  if (minutes < 60) return `还剩 ${Math.max(1, minutes)} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `还剩 ${hours} 小时`
  const days = Math.floor(hours / 24)
  return `还剩 ${days} 天`
}

function perfMeterColor(perf: number): string {
  if (perf >= 90) return '#4ade80'
  if (perf >= 50) return '#facc15'
  return '#ef4444'
}

function describe(value: number, invertedHp: boolean): string {
  if (invertedHp) {
    if (value >= 80) return '良好'
    if (value >= 50) return '轻伤'
    if (value >= 25) return '重伤'
    return '濒死'
  }
  if (value < 25) return '良好'
  if (value < 50) return '微感'
  if (value < 75) return '明显'
  if (value < 90) return '严重'
  return '极限'
}
