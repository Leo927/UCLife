import { useQueryFirst, useTrait } from 'koota/react'
import { IsPlayer, Vitals, Health, Money, Job, Home, JobPerformance, Workstation, Bed, Attributes, Position, MoveTarget, QueuedInteract, QueuedTalk, Reputation, Character, Ambitions, Conditions } from '../ecs/traits'
import {
  getConditionTemplate, severityTier,
  SEVERITY_TIER_ZH, SEVERITY_TIER_COLOR, TREATMENT_TIER_ZH,
  type ConditionTemplate,
} from '../character/conditions'
import { Portrait } from '../render/portrait/react/Portrait'
import type { BedTier } from '../ecs/traits'
import { useUI } from './uiStore'
import { useClock } from '../sim/clock'
import { SKILL_ORDER, SKILLS, levelOf, progressInLevel, BOOK_CAP_XP, getSkillXp } from '../character/skills'
import { selfTreatCondition } from '../systems/physiology'
import { dowLabel, getJobSpec } from '../data/jobs'
import { STAT_ORDER, STATS } from '../character/stats'
import { getStat } from '../stats/sheet'
import { attributesConfig, jobsConfig, vitalsConfig, physiologyConfig } from '../config'
import { tierOf as factionTierOf, factionMeta, type FactionId } from '../data/factions'
import { getAmbition } from '../character/ambitions'
import { playUi } from '../audio/player'

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
  const job = useTrait(player, Job)
  const wsEnt = job?.workstation ?? null
  const wsTrait = useTrait(wsEnt, Workstation)
  const wsPos = useTrait(wsEnt, Position)
  const currentJob = wsTrait ? getJobSpec(wsTrait.specId) : null
  const home = useTrait(player, Home)
  const homeBedEnt = home?.bed ?? null
  const homeBed = useTrait(homeBedEnt, Bed)
  const homeBedPos = useTrait(homeBedEnt, Position)
  const perfTrait = useTrait(player, JobPerformance)
  const attrs = useTrait(player, Attributes)
  const reputation = useTrait(player, Reputation)
  const character = useTrait(player, Character)
  const ambitions = useTrait(player, Ambitions)
  const conditions = useTrait(player, Conditions)
  // Subscribe to gameDate so the rent countdown ticks live.
  const gameMs = useClock((s) => s.gameDate.getTime())

  if (!open) return null

  // No QueuedInteract — the player might just want to check on their home;
  // if they want to rent/sleep they can click the bed.
  const walkHome = () => {
    if (!player || !homeBedPos) return
    playUi('ui.status.walk-home')
    player.set(MoveTarget, { x: homeBedPos.x, y: homeBedPos.y })
    if (player.has(QueuedInteract)) player.remove(QueuedInteract)
    if (player.has(QueuedTalk)) player.remove(QueuedTalk)
    setOpen(false)
  }

  const walkToJob = () => {
    if (!player || !wsPos) return
    playUi('ui.status.walk-job')
    player.set(MoveTarget, { x: wsPos.x, y: wsPos.y })
    if (!player.has(QueuedInteract)) player.add(QueuedInteract)
    if (player.has(QueuedTalk)) player.remove(QueuedTalk)
    setOpen(false)
  }

  const close = () => { playUi('ui.status.close'); setOpen(false) }
  const openAmbitions = () => {
    playUi('ui.status.open-ambitions')
    setOpen(false)
    useUI.getState().setAmbitions(true)
  }

  return (
    <div className="status-overlay" onClick={close}>
      <div className="status-panel status-panel--wide" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>状态</h2>
          <button className="status-close" onClick={close} aria-label="关闭">✕</button>
        </header>

        <div className="status-body">
        <section className="status-section status-identity status-section--full">
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
          <h3>志向</h3>
          {ambitions && ambitions.active.length > 0 ? (
            <>
              {ambitions.active.map((slot) => {
                const def = getAmbition(slot.id)
                if (!def) return null
                const stage = def.stages[slot.currentStage]
                const total = def.stages.length
                return (
                  <div key={slot.id} className="status-job">
                    <span className="status-job-name">{def.nameZh}</span>
                    <span className="status-meta">
                      {stage
                        ? `第 ${slot.currentStage + 1} / ${total} · ${stage.stageNameZh}`
                        : `已完成全部 ${total} 阶段`}
                    </span>
                  </div>
                )
              })}
              <div className="status-job" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="status-link"
                  onClick={openAmbitions}
                  data-open-ambitions
                >
                  查看与切换志向
                </button>
              </div>
            </>
          ) : (
            <div className="status-job">
              <button
                type="button"
                className="status-link"
                onClick={openAmbitions}
                data-open-ambitions
              >
                选择志向
              </button>
            </div>
          )}
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
                <button
                  type="button"
                  className="status-link status-job-name"
                  onClick={walkToJob}
                  disabled={!wsPos}
                  title="走向工作地点"
                >
                  {currentJob.jobTitle}
                </button>
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

        <section className="status-section" data-testid="conditions-section">
          <h3>健康</h3>
          {health && <StatusBar label="生命" value={health.hp} invert />}
          {conditions && conditions.list.filter((c) => c.phase !== 'incubating').length === 0 && (
            <p className="status-muted">目前没有任何身体不适。</p>
          )}
          {conditions?.list.filter((c) => c.phase !== 'incubating').map((inst) => {
            const t = getConditionTemplate(inst.templateId)
            if (!t) return null
            const onSelfTreat = (player && t.bodyPartScope === 'bodyPart' && t.requiredTreatmentTier <= 1)
              ? () => {
                if (!player) return
                const lvl = levelOf(getSkillXp(player, 'medicine'))
                if (selfTreatCondition(player, inst.instanceId, physiologyConfig.selfTreatMinSkillLevel, lvl)) {
                  playUi('ui.condition-strip.click')
                }
              }
              : null
            const medLevel = player ? levelOf(getSkillXp(player, 'medicine')) : 0
            const canSelfTreat = !!onSelfTreat &&
              medLevel >= physiologyConfig.selfTreatMinSkillLevel &&
              inst.currentTreatmentTier < 1
            return (
              <ConditionCard
                key={inst.instanceId}
                instance={inst}
                template={t}
                canSelfTreat={canSelfTreat}
                onSelfTreat={onSelfTreat ?? (() => {})}
              />
            )
          })}
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
            <StatRow key={id} label={STATS[id].label} value={getStat(attrs.sheet, id)} />
          ))}
        </section>

        <section className="status-section">
          <h3>技能</h3>
          {attrs && SKILL_ORDER.map((id) => {
            const xp = getStat(attrs.sheet, id)
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

function ConditionCard({
  instance, template, canSelfTreat, onSelfTreat,
}: {
  instance: { instanceId: string; templateId: string; phase: string; severity: number; diagnosed: boolean; diagnosedDay: number | null; currentTreatmentTier: number }
  template: ConditionTemplate
  canSelfTreat: boolean
  onSelfTreat: () => void
}) {
  const tier = severityTier(instance.severity)
  const heading = instance.diagnosed ? template.displayName : '某种疾病'
  const blurb =
    tier === 'severe' ? template.symptomBlurbs.severe :
    tier === 'moderate' ? template.symptomBlurbs.moderate :
    template.symptomBlurbs.mild
  const stalled = instance.phase === 'stalled'
  return (
    <div className="condition-card" data-template={template.id} data-phase={instance.phase} data-diagnosed={instance.diagnosed ? '1' : '0'}>
      <div className="condition-card-head">
        <span className="condition-card-name">{heading}</span>
        <span className="condition-card-tier" style={{ color: SEVERITY_TIER_COLOR[tier] }}>{SEVERITY_TIER_ZH[tier]}</span>
      </div>
      <div className="condition-card-blurb">{blurb}</div>
      {instance.diagnosed && (
        <div className="condition-card-meta">
          严重度 {Math.round(instance.severity)} · 治疗等级 {TREATMENT_TIER_ZH[instance.currentTreatmentTier] ?? '?'}
        </div>
      )}
      {stalled && (
        <div className="condition-card-stalled">未见好转 — 需要药店或诊所介入。</div>
      )}
      {canSelfTreat && (
        <button
          className="condition-card-self-treat"
          data-testid="condition-self-treat"
          data-template={template.id}
          onClick={onSelfTreat}
        >
          自行包扎
        </button>
      )}
    </div>
  )
}

function StatusBar({ label, value, invert = false }: { label: string; value: number; invert?: boolean }) {
  const filled = Math.max(0, Math.min(100, value))
  const goodness = invert ? filled : 100 - filled
  const baseColor = goodness > 60 ? '#4ade80' : goodness > 30 ? '#facc15' : '#ef4444'
  const flavor = describe(value, invert)
  const color = flavor.critical ? vitalsConfig.flavor.criticalColor : baseColor
  const rowClass = flavor.critical ? 'status-bar-row status-bar-row--critical' : 'status-bar-row'
  return (
    <div className={rowClass}>
      <span className="status-bar-label">{label}</span>
      <div className="status-bar-track">
        <div className="status-bar-fill" style={{ width: `${filled}%`, background: color }} />
      </div>
      <span className="status-bar-desc" style={{ color }}>{flavor.label}</span>
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

function describe(value: number, invertedHp: boolean): { label: string; critical: boolean } {
  if (invertedHp) {
    for (const band of vitalsConfig.flavor.hpBands) {
      if (value >= band.atLeast) return { label: band.label, critical: false }
    }
    const tail = vitalsConfig.flavor.hpBands[vitalsConfig.flavor.hpBands.length - 1]
    return { label: tail.label, critical: false }
  }
  for (const band of vitalsConfig.flavor.vitalBands) {
    if (value < band.under) return { label: band.label, critical: !!band.critical }
  }
  const tail = vitalsConfig.flavor.vitalBands[vitalsConfig.flavor.vitalBands.length - 1]
  return { label: tail.label, critical: !!tail.critical }
}
