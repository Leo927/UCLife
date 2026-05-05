// Two-step civilian clinic modal. Step 1: pay the diagnosis fee →
// flips `diagnosed = true` on the player's symptomatic conditions and
// reveals their canonical names. Step 2: pick a treatment tier (untreated /
// pharmacy / clinic) and pay the cost — commitTreatment writes the tier
// onto the instance, the next day:rollover phase tick reads it.
//
// Phase 4.0 ships the civilian clinic only. AE clinic + first-clinic-free
// coupon stay deferred per Design/characters/physiology-ux.md § 7.

import { useState } from 'react'
import { useQueryFirst, useTrait } from 'koota/react'
import { IsPlayer, Money, Conditions } from '../ecs/traits'
import { useUI } from './uiStore'
import { useClock, gameDayNumber } from '../sim/clock'
import { getConditionTemplate, TREATMENT_TIER_ZH } from '../character/conditions'
import { diagnoseCondition, commitTreatment } from '../systems/physiology'
import { emitSim } from '../sim/events'

const DIAGNOSIS_FEE = 8
const PHARMACY_COST = 20
const CLINIC_INPATIENT_COST = 60

export function ClinicModal() {
  const open = useUI((s) => s.clinicOpen)
  const setClinic = useUI((s) => s.setClinic)
  const player = useQueryFirst(IsPlayer, Money, Conditions)
  const money = useTrait(player, Money)
  const conditions = useTrait(player, Conditions)
  const [tier, setTier] = useState<number>(1)

  if (!open) return null

  const close = () => { setClinic(false); setTier(1) }
  const symptomatic = conditions?.list.filter((c) => c.phase !== 'incubating') ?? []
  const undiagnosed = symptomatic.filter((c) => !c.diagnosed)
  const diagnosed = symptomatic.filter((c) => c.diagnosed)

  const payDiagnosis = () => {
    if (!player || !money || money.amount < DIAGNOSIS_FEE || undiagnosed.length === 0) return
    player.set(Money, { amount: money.amount - DIAGNOSIS_FEE })
    const day = gameDayNumber(useClock.getState().gameDate)
    for (const inst of undiagnosed) diagnoseCondition(player, inst.instanceId, day)
  }

  const treatmentCost = (t: number): number => {
    if (t === 0) return 0
    if (t === 1) return PHARMACY_COST
    return CLINIC_INPATIENT_COST
  }

  const treatmentLabel = (t: number): string =>
    t === 0 ? '自我护理' : t === 1 ? '药店处方' : '住院观察'

  const treatmentEta = (t: number): string =>
    t === 0 ? '可能停滞，无加速' :
    t === 1 ? '推荐 — 1.5× 恢复' :
    '最快 — 2.0× 恢复，留疤风险更低'

  const commit = () => {
    if (!player || !money || diagnosed.length === 0) return
    const cost = treatmentCost(tier)
    if (money.amount < cost) return
    if (cost > 0) player.set(Money, { amount: money.amount - cost })
    // Apply tier to every diagnosed condition. Treatment expires after 5
    // game-days (covers the rest of a typical cold/food-poisoning arc).
    const day = gameDayNumber(useClock.getState().gameDate)
    for (const inst of diagnosed) commitTreatment(player, inst.instanceId, tier, day + 5)
    if (cost > 0) emitSim('toast', { textZh: `治疗已支付 ¥${cost}` })
    close()
  }

  return (
    <div className="status-overlay" onClick={close} data-testid="clinic-modal">
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>公共诊所</h2>
          <button className="status-close" onClick={close} aria-label="关闭">✕</button>
        </header>

        <section className="status-section">
          <div className="shop-money">金钱: <span className="shop-money-amount">¥{money?.amount ?? 0}</span></div>
        </section>

        {symptomatic.length === 0 && (
          <section className="status-section">
            <p className="status-muted">你目前没有任何身体不适。</p>
          </section>
        )}

        {undiagnosed.length > 0 && (
          <section className="status-section">
            <h3>诊断</h3>
            <p className="status-muted" style={{ marginBottom: 8 }}>
              当前症状 {undiagnosed.length} 项尚未诊断。诊断费 ¥{DIAGNOSIS_FEE}。
            </p>
            <button
              className="shop-item-buy"
              disabled={(money?.amount ?? 0) < DIAGNOSIS_FEE}
              onClick={payDiagnosis}
              data-testid="clinic-diagnose"
            >
              接受诊断 (¥{DIAGNOSIS_FEE})
            </button>
          </section>
        )}

        {diagnosed.length > 0 && (
          <section className="status-section">
            <h3>治疗方案</h3>
            {diagnosed.map((inst) => {
              const t = getConditionTemplate(inst.templateId)
              if (!t) return null
              return (
                <div key={inst.instanceId} className="condition-card-meta" style={{ marginBottom: 4 }}>
                  · {t.displayName}（严重度 {Math.round(inst.severity)}，需要 {TREATMENT_TIER_ZH[t.requiredTreatmentTier] ?? '?'}）
                </div>
              )
            })}
            <div style={{ marginTop: 8 }}>
              {[0, 1, 2].map((t) => (
                <div
                  key={t}
                  className={`clinic-treatment-row ${tier === t ? 'selected' : ''} ${(money?.amount ?? 0) < treatmentCost(t) ? 'disabled' : ''}`}
                  onClick={() => { if ((money?.amount ?? 0) >= treatmentCost(t)) setTier(t) }}
                  data-testid={`clinic-tier-${t}`}
                >
                  <div>
                    <div className="clinic-treatment-name">{treatmentLabel(t)}</div>
                    <div className="clinic-treatment-eta">{treatmentEta(t)}</div>
                  </div>
                  <div className="clinic-treatment-cost">¥{treatmentCost(t)}</div>
                </div>
              ))}
              <button
                className="shop-item-buy"
                style={{ marginTop: 8 }}
                disabled={(money?.amount ?? 0) < treatmentCost(tier)}
                onClick={commit}
                data-testid="clinic-confirm"
              >
                确认治疗
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
