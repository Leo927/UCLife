// Phase 4.2 — AE clinic faction-perk modal. Mirrors clinic.tsx but
// gates entry on Anaheim reputation and stamps two perks on the
// committed TreatmentEvent: a peak-reduction bonus on top of the
// tier-2 base, and a raised scar threshold for that instance only.
// Each visit also pays a small Anaheim rep cost so the perk has
// weight against the rank-3 / rank-4 engineer climb.

import { useState } from 'react'
import { useQueryFirst, useTrait } from 'koota/react'
import { IsPlayer, Money, Conditions, Reputation, Flags } from '../../../ecs/traits'
import { useUI } from '../../uiStore'
import { useClock, gameDayNumber } from '../../../sim/clock'
import { getConditionTemplate, TREATMENT_TIER_ZH } from '../../../character/conditions'
import { diagnoseCondition, commitTreatment } from '../../../systems/physiology'
import { addRep } from '../../../systems/reputation'
import { emitSim } from '../../../sim/events'
import { playUi } from '../../../audio/player'
import { dialogueText } from '../../../data/dialogueText'
import { FIRST_CLINIC_COUPON_FLAG, consumeFirstClinicCoupon } from '../../../character/firstClinicCoupon'
import { physiologyConfig, factionsConfig } from '../../../config'
import type { DialogueCtx, DialogueNode } from '../types'

// Treatment costs mirror clinic.tsx's tier table; AE clinic doesn't
// undercut civilian pricing on the listed verbs — the perk is in the
// outcome, not the dollar amount.
const DIAGNOSIS_FEE = 8
const PHARMACY_COST = 20
const CLINIC_INPATIENT_COST = 60

export function aeClinicBranch(ctx: DialogueCtx): DialogueNode | null {
  if (!ctx.roles.isAEDoctorOnDuty) return null
  return {
    id: 'aeClinic',
    label: dialogueText.buttons.aeClinic,
    info: dialogueText.branches.aeClinic.title,
    specialUI: () => <AEClinicPanel />,
  }
}

function AEClinicPanel() {
  const player = useQueryFirst(IsPlayer, Money, Conditions)
  const money = useTrait(player, Money)
  const conditions = useTrait(player, Conditions)
  const reputation = useTrait(player, Reputation)
  const flags = useTrait(player, Flags)
  const [tier, setTier] = useState<number>(2)

  if (!player) return null

  const aeMeta = factionsConfig.catalog.anaheim
  const aeRep = reputation?.rep.anaheim ?? 0
  const minRep = physiologyConfig.aeClinicMinRep
  const gateOpen = aeRep >= minRep

  if (!gateOpen) {
    return (
      <>
        <h3 style={{ color: aeMeta.accentColor }}>{dialogueText.branches.aeClinic.title}</h3>
        <p className="status-muted" style={{ marginTop: 8 }}>
          {dialogueText.branches.aeClinic.gateLocked}
        </p>
        <div className="status-meta" style={{ marginTop: 8 }}>
          AE 声望: <strong>{aeRep >= 0 ? '+' : ''}{Math.round(aeRep)}</strong> · 需 ≥ {minRep}
        </div>
      </>
    )
  }

  const symptomatic = conditions?.list.filter((c) => c.phase !== 'incubating') ?? []
  const undiagnosed = symptomatic.filter((c) => !c.diagnosed)
  const diagnosed = symptomatic.filter((c) => c.diagnosed)
  const couponAvailable = !flags?.flags[FIRST_CLINIC_COUPON_FLAG]
  const diagnosisFee = couponAvailable ? 0 : DIAGNOSIS_FEE

  const payDiagnosis = () => {
    if (!money || money.amount < diagnosisFee || undiagnosed.length === 0) return
    playUi('ui.clinic.diagnose')
    if (diagnosisFee > 0) player.set(Money, { amount: money.amount - diagnosisFee })
    if (couponAvailable) consumeFirstClinicCoupon(player)
    const day = gameDayNumber(useClock.getState().gameDate)
    for (const inst of undiagnosed) diagnoseCondition(player, inst.instanceId, day)
  }

  const treatmentCost = (t: number): number => {
    if (t === 0) return 0
    if (t === 1) return PHARMACY_COST
    return CLINIC_INPATIENT_COST
  }

  const treatmentLabel = (t: number): string =>
    t === 0 ? '自我护理' : t === 1 ? '药店处方' : 'AE 住院'

  // Tier 2 is the AE-perk row; surface the recommended-row blurb on it
  // and call out the perk for player legibility.
  const treatmentEta = (t: number): string =>
    t === 0 ? '可能停滞，无加速' :
    t === 1 ? '1.5× 恢复' :
    `2.0× 恢复 · ${dialogueText.branches.aeClinic.perkBlurb}`

  const commit = () => {
    if (!money || diagnosed.length === 0) return
    const cost = treatmentCost(tier)
    if (money.amount < cost) return
    playUi('ui.clinic.confirm')
    if (cost > 0) player.set(Money, { amount: money.amount - cost })
    const day = gameDayNumber(useClock.getState().gameDate)
    // AE perks ride only on the tier-2 (住院) row — pharmacy and
    // self-care don't get the bonus; the perk is the "AE doctor saw
    // me herself" outcome, not the prescription bottle.
    const perks = tier === 2 ? {
      peakReductionBonus: physiologyConfig.aeClinicPeakReductionBonus,
      scarThresholdOverride: null as number | null,  // overridden per instance below
    } : undefined
    for (const inst of diagnosed) {
      const template = getConditionTemplate(inst.templateId)
      let p = perks
      if (template !== undefined && perks !== undefined) {
        p = {
          peakReductionBonus: perks.peakReductionBonus,
          scarThresholdOverride: template.scarThreshold + physiologyConfig.aeClinicScarThresholdRaise,
        }
      }
      commitTreatment(player, inst.instanceId, tier, day + 5, p)
    }
    if (cost > 0) emitSim('toast', { textZh: `治疗已支付 ¥${cost}` })
    // AE clinic rep cost — single ding per visit regardless of how
    // many conditions were treated in one commit.
    if (tier === 2 && physiologyConfig.aeClinicRepCost > 0) {
      addRep(player, 'anaheim', -physiologyConfig.aeClinicRepCost)
    }
    useUI.getState().setDialogNPC(null)
  }

  return (
    <>
      <h3 style={{ color: aeMeta.accentColor }}>{dialogueText.branches.aeClinic.title}</h3>
      <p className="status-muted" style={{ marginTop: 4 }}>{dialogueText.branches.aeClinic.gateOpenIntro}</p>
      <div className="shop-money">
        金钱: <span className="shop-money-amount">¥{money?.amount ?? 0}</span>
        {' · '}AE 声望: <strong>{aeRep >= 0 ? '+' : ''}{Math.round(aeRep)}</strong>
      </div>

      {symptomatic.length === 0 && (
        <p className="status-muted" style={{ marginTop: 8 }}>{dialogueText.branches.aeClinic.noSymptoms}</p>
      )}

      {undiagnosed.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <p className="status-muted" style={{ marginBottom: 8 }}>
            当前症状 {undiagnosed.length} 项尚未诊断。诊断费 ¥{diagnosisFee}。
          </p>
          {couponAvailable && (
            <p className="status-muted" style={{ marginBottom: 8 }} data-testid="ae-clinic-coupon">
              {dialogueText.branches.aeClinic.couponBlurb}
            </p>
          )}
          <button
            className="shop-item-buy"
            disabled={(money?.amount ?? 0) < diagnosisFee}
            onClick={payDiagnosis}
          >
            接受诊断 (¥{diagnosisFee})
          </button>
        </div>
      )}

      {diagnosed.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <h3>{dialogueText.branches.aeClinic.treatmentHeader}</h3>
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
                onClick={() => { if ((money?.amount ?? 0) >= treatmentCost(t)) { playUi('ui.clinic.tier-select'); setTier(t) } }}
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
            >
              确认治疗
            </button>
          </div>
        </div>
      )}
    </>
  )
}
