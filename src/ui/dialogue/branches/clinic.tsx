import { useState } from 'react'
import { useQueryFirst, useTrait } from 'koota/react'
import { IsPlayer, Money, Conditions, Flags } from '../../../ecs/traits'
import { useUI } from '../../uiStore'
import { useClock, gameDayNumber } from '../../../sim/clock'
import { getConditionTemplate, TREATMENT_TIER_ZH } from '../../../character/conditions'
import { diagnoseCondition, commitTreatment } from '../../../systems/physiology'
import { emitSim } from '../../../sim/events'
import { playUi } from '../../../audio/player'
import { dialogueText } from '../../../data/dialogueText'
import { FIRST_CLINIC_COUPON_FLAG, consumeFirstClinicCoupon } from '../../../character/firstClinicCoupon'
import { useWarState } from '../../../sim/warState'
import { useConscription, grantMedicalLetter } from '../../../sim/conscriptionState'
import { conscriptionConfig } from '../../../config'
import type { DialogueCtx, DialogueNode } from '../types'

const DIAGNOSIS_FEE = 8
const PHARMACY_COST = 20
const CLINIC_INPATIENT_COST = 60

export function clinicBranch(ctx: DialogueCtx): DialogueNode | null {
  if (!ctx.roles.isDoctorOnDuty) return null
  return {
    id: 'clinic',
    label: dialogueText.buttons.clinic,
    info: dialogueText.branches.clinic.title,
    specialUI: () => <ClinicPanel />,
  }
}

function ClinicPanel() {
  const player = useQueryFirst(IsPlayer, Money, Conditions)
  const money = useTrait(player, Money)
  const conditions = useTrait(player, Conditions)
  const flags = useTrait(player, Flags)
  const [tier, setTier] = useState<number>(1)
  // Phase 7.0.C — wartime: the clinic issues a medical letter that tilts the
  // conscription refusal roll. One per draft; consumed when used.
  const wartime = useWarState((s) => s.isWartime)
  const medicalLetterHeld = useConscription((s) => s.medicalLetterHeld)

  if (!player) return null

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
    t === 0 ? '自我护理' : t === 1 ? '药店处方' : '住院观察'

  const treatmentEta = (t: number): string =>
    t === 0 ? '可能停滞，无加速' :
    t === 1 ? '推荐 — 1.5× 恢复' :
    '最快 — 2.0× 恢复，留疤风险更低'

  const commit = () => {
    if (!money || diagnosed.length === 0) return
    const cost = treatmentCost(tier)
    if (money.amount < cost) return
    playUi('ui.clinic.confirm')
    if (cost > 0) player.set(Money, { amount: money.amount - cost })
    const day = gameDayNumber(useClock.getState().gameDate)
    for (const inst of diagnosed) commitTreatment(player, inst.instanceId, tier, day + 5)
    if (cost > 0) emitSim('toast', { textZh: `治疗已支付 ¥${cost}` })
    useUI.getState().setDialogNPC(null)
  }

  const letterFee = conscriptionConfig.medicalLetterFee
  const requestLetter = () => {
    if (!money || money.amount < letterFee || medicalLetterHeld) return
    playUi('ui.clinic.confirm')
    player.set(Money, { amount: money.amount - letterFee })
    grantMedicalLetter()
    emitSim('toast', { textZh: `医学证明已开具 ¥${letterFee}` })
  }

  return (
    <>
      <h3>{dialogueText.branches.clinic.title}</h3>
      <div className="shop-money">金钱: <span className="shop-money-amount">¥{money?.amount ?? 0}</span></div>

      {symptomatic.length === 0 && (
        <p className="status-muted" style={{ marginTop: 8 }}>{dialogueText.branches.clinic.noSymptoms}</p>
      )}

      {undiagnosed.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <p className="status-muted" style={{ marginBottom: 8 }}>
            当前症状 {undiagnosed.length} 项尚未诊断。诊断费 ¥{diagnosisFee}。
          </p>
          {couponAvailable && (
            <p className="status-muted" style={{ marginBottom: 8 }} data-testid="clinic-coupon">
              {dialogueText.branches.clinic.couponBlurb}
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
          <h3>{dialogueText.branches.clinic.treatmentHeader}</h3>
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

      {wartime && (
        <div style={{ marginTop: 12 }} data-clinic-medical-letter>
          <h3>战时医学证明</h3>
          {medicalLetterHeld ? (
            <p className="status-muted" style={{ marginTop: 4 }}>你已持有一份医学证明。</p>
          ) : (
            <>
              <p className="status-muted" style={{ marginBottom: 8 }}>
                一份盖章的医学证明，可在征召时作为缓役依据。
              </p>
              <button
                className="shop-item-buy"
                disabled={(money?.amount ?? 0) < letterFee}
                onClick={requestLetter}
              >
                申请医学证明 (¥{letterFee})
              </button>
            </>
          )}
        </div>
      )}
    </>
  )
}
