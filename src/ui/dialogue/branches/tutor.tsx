// Issue #142 — skill-perk respec at the on-duty Tutor (Design/characters/
// skills.md § Respec). Worker-not-workstation: this branch only renders on
// the tutor NPC's talk-verb while they're on shift; an empty seat exposes
// no verb. Respec refunds one (skill, tier) slot for money + lost days,
// both scaling with the player's prior respec count.

import { useQueryFirst, useTrait } from 'koota/react'
import { IsPlayer, Money, Effects, SkillPerkState } from '../../../ecs/traits'
import { useUI } from '../../uiStore'
import { useClock } from '../../../sim/clock'
import { SKILLS } from '../../../character/skills'
import {
  allPicks, respecCost, respecCountOf, respecSkillPerk,
} from '../../../character/skillPerks'
import { emitSim } from '../../../sim/events'
import { playUi } from '../../../audio/player'
import type { DialogueCtx, DialogueNode } from '../types'

const MINUTES_PER_DAY = 24 * 60

export function tutorBranch(ctx: DialogueCtx): DialogueNode | null {
  if (!ctx.roles.isTutorOnDuty) return null
  return {
    id: 'tutor',
    label: '技能转科',
    info: '导师放下杯子，示意你坐到旁边。「想推翻哪一段过去？说来听听。」',
    specialUI: () => <TutorRespecPanel />,
  }
}

function TutorRespecPanel() {
  const player = useQueryFirst(IsPlayer, Money)
  const money = useTrait(player, Money)
  // Subscribe so the list refreshes the moment a respec lands.
  useTrait(player, Effects)
  useTrait(player, SkillPerkState)

  if (!player) return null

  const picks = allPicks(player)
  const cost = respecCost(respecCountOf(player))
  const affordable = (money?.amount ?? 0) >= cost.money

  const commit = (skill: (typeof picks)[number]['skill'], tier: number) => {
    if (!money || money.amount < cost.money) return
    if (!respecSkillPerk(player, skill, tier)) return
    playUi('ui.clinic.confirm')
    player.set(Money, { amount: money.amount - cost.money })
    // The retraining montage: the lost days pass in a single committed
    // block, same shape as the advanceGameDays debug verb.
    useClock.getState().advance(cost.days * MINUTES_PER_DAY)
    emitSim('toast', { textZh: `转科完成 — 花费 ¥${cost.money}，闭关 ${cost.days} 天。该专精位已空出。` })
    useUI.getState().setDialogNPC(null)
  }

  return (
    <div data-testid="tutor-respec">
      <h3>技能转科</h3>
      <div className="shop-money">金钱: <span className="shop-money-amount">¥{money?.amount ?? 0}</span></div>
      <p className="status-muted" style={{ marginTop: 8 }} data-testid="tutor-respec-cost">
        本次转科收费 ¥{cost.money}，需闭关 {cost.days} 天。每多转一次，代价更重。
      </p>
      {picks.length === 0 ? (
        <p className="status-muted">「你还没有定下任何专精——没什么可推翻的。」</p>
      ) : (
        picks.map((p) => (
          <button
            key={`${p.skill}:${p.tier}`}
            className="shop-item-buy"
            style={{ marginTop: 8, display: 'block' }}
            disabled={!affordable}
            data-testid={`tutor-respec-${p.skill}-${p.tier}`}
            onClick={() => commit(p.skill, p.tier)}
          >
            放弃「{p.nameZh}」（{SKILLS[p.skill].label} Lv{p.tier}） — ¥{cost.money} · {cost.days} 天
          </button>
        ))
      )}
    </div>
  )
}
