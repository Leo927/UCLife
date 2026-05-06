// Pharmacist's inline dialog (rendered in NPCDialog when the player chats
// up the on-duty civilian_pharmacist). The pharmacy doesn't diagnose —
// only sells pharmacy-tier (tier 1) treatment for already-diagnosed
// conditions. Players who haven't seen a doctor get a hint to visit the
// clinic first.

import { useQueryFirst, useTrait } from 'koota/react'
import { IsPlayer, Money, Conditions } from '../../ecs/traits'
import { useUI } from '../uiStore'
import { useClock, gameDayNumber } from '../../sim/clock'
import { getConditionTemplate } from '../../character/conditions'
import { commitTreatment } from '../../systems/physiology'
import { emitSim } from '../../sim/events'

const PHARMACY_COST = 20

export function PharmacyConversation() {
  const player = useQueryFirst(IsPlayer, Money, Conditions)
  const money = useTrait(player, Money)
  const conditions = useTrait(player, Conditions)

  if (!player) return null

  const symptomatic = conditions?.list.filter((c) => c.phase !== 'incubating') ?? []
  const diagnosed = symptomatic.filter((c) => c.diagnosed)
  const undiagnosed = symptomatic.filter((c) => !c.diagnosed)

  const buy = () => {
    if (!money || diagnosed.length === 0) return
    if (money.amount < PHARMACY_COST) return
    player.set(Money, { amount: money.amount - PHARMACY_COST })
    const day = gameDayNumber(useClock.getState().gameDate)
    for (const inst of diagnosed) commitTreatment(player, inst.instanceId, 1, day + 5)
    emitSim('toast', { textZh: `已支付 ¥${PHARMACY_COST} · 处方药已购` })
    useUI.getState().setDialogNPC(null)
  }

  return (
    <section className="status-section conversation-extension" data-testid="pharmacy-modal">
      <h3>药店</h3>
      <div className="shop-money">金钱: <span className="shop-money-amount">¥{money?.amount ?? 0}</span></div>

      {symptomatic.length === 0 && (
        <p className="status-muted" style={{ marginTop: 8 }}>你目前没有任何身体不适。</p>
      )}

      {undiagnosed.length > 0 && diagnosed.length === 0 && (
        <p className="status-muted" style={{ marginTop: 8 }}>
          药剂师只能按已确诊的病情配药 · 请先到诊所就诊。
        </p>
      )}

      {diagnosed.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <p className="status-muted" style={{ marginBottom: 8 }}>已确诊条目，可一次性购入处方药 (¥{PHARMACY_COST})：</p>
          {diagnosed.map((inst) => {
            const t = getConditionTemplate(inst.templateId)
            if (!t) return null
            return (
              <div key={inst.instanceId} className="condition-card-meta" style={{ marginBottom: 4 }}>
                · {t.displayName}（严重度 {Math.round(inst.severity)}）
              </div>
            )
          })}
          <button
            className="shop-item-buy"
            style={{ marginTop: 8 }}
            disabled={(money?.amount ?? 0) < PHARMACY_COST}
            onClick={buy}
            data-testid="pharmacy-buy"
          >
            购买处方药 (¥{PHARMACY_COST})
          </button>
        </div>
      )}
    </section>
  )
}
