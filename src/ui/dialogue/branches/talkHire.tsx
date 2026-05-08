// Phase 5.5.4 talk-verb hire. Branch on the per-NPC dialogue tree:
// when the player chats up an NPC who is *not* already in the player-
// faction, surfaces an "邀请加入" branch gated by faction rep + opinion.
//
// At least one gate must clear:
//   • factionRepGate — player's rep with the configured faction is
//     ≥ min (default: AE 30+).
//   • opinionGate    — the target NPC's opinion of the player is ≥ min.
//
// On accept: signing bonus from recruitment.json5 transfers from the
// player's wallet to the NPC's wallet, the NPC clears any current Job
// pointer, and is left as a faction-of-one member by virtue of having
// the player's wallet as their first paid bonus. The next time
// assignIdleMembers runs (secretary verb), they'll fill an open station.

import type { Entity } from 'koota'
import {
  Applicant, Building, Character, FactionRole, IsPlayer, Job, Knows, Money,
  Owner, Position, RecruitedTo, Workstation,
} from '../../../ecs/traits'
import { useUI } from '../../uiStore'
import { recruitmentConfig } from '../../../config'
import { getRep } from '../../../systems/reputation'
import { isPlayerOwnedBuilding } from '../../../ecs/playerFaction'
import { world } from '../../../ecs/world'
import { playUi } from '../../../audio/player'
import { dialogueText } from '../../../data/dialogueText'
import type { DialogueCtx, DialogueNode } from '../types'

export function talkHireBranch(ctx: DialogueCtx): DialogueNode | null {
  const target = ctx.npc
  const player = world.queryFirst(IsPlayer)
  if (!player || target === player) return null
  if (target.has(Applicant)) return null

  const fr = target.get(FactionRole)
  if (fr && fr.faction === 'anaheim') return null

  const job = target.get(Job)
  if (job?.workstation && isStationInPlayerOwnedBuilding(job.workstation, player)) {
    return null
  }

  const gates = recruitmentConfig.talkVerbHire
  const aeRep = getRep(player, gates.factionRepGate.faction)
  const factionRepOk = aeRep >= gates.factionRepGate.min

  const edge = target.has(Knows(player)) ? target.get(Knows(player)) : null
  const opinion = edge?.opinion ?? 0
  const opinionOk = opinion >= gates.opinionGate.min
  const gateOpen = factionRepOk || opinionOk

  const far = !factionRepOk && opinion < gates.opinionGate.min - 25
  if (far) return null

  const reasons: string[] = []
  if (!factionRepOk) reasons.push(`AE声望 ${aeRep} → 需 ≥ ${gates.factionRepGate.min}`)
  if (!opinionOk) reasons.push(`对方印象 ${Math.round(opinion)} → 需 ≥ ${gates.opinionGate.min}`)

  const offerLabel = gateOpen
    ? `提出邀请 · 付 ¥${gates.signingBonus}`
    : '条件未达 · 不便邀请'

  const onAccept = () => {
    if (!gateOpen) {
      useUI.getState().showToast('对方还不太信任你 · 多打几次照面再来谈吧')
      return
    }
    const m = player.get(Money)
    if (!m || m.amount < gates.signingBonus) {
      useUI.getState().showToast(`需要 ¥${gates.signingBonus} 签约金 · 钱不够`)
      return
    }
    playUi('ui.hr.accept')
    player.set(Money, { amount: m.amount - gates.signingBonus })
    const targetMoney = target.get(Money)
    if (targetMoney) {
      target.set(Money, { amount: targetMoney.amount + gates.signingBonus })
    } else {
      target.add(Money({ amount: gates.signingBonus }))
    }
    if (job?.workstation) {
      const cur = job.workstation.get(Workstation)
      if (cur && cur.occupant === target) {
        job.workstation.set(Workstation, { ...cur, occupant: null })
      }
    }
    target.set(Job, { workstation: null, unemployedSinceMs: 0 })
    if (target.has(RecruitedTo)) target.set(RecruitedTo, { owner: player })
    else target.add(RecruitedTo({ owner: player }))

    if (target.has(Knows(player))) {
      const e = target.get(Knows(player))!
      target.set(Knows(player), { ...e, opinion: Math.min(100, e.opinion + 10) })
    }

    const ch = target.get(Character)
    useUI.getState().showToast(`${ch?.name ?? '一名雇员'}已加入faction · 签约金 ¥${gates.signingBonus}`)
    useUI.getState().setDialogNPC(null)
  }

  const onDecline = () => {
    playUi('ui.npc.farewell')
    useUI.getState().setDialogNPC(null)
  }

  const intro = `签约金 ¥${gates.signingBonus} · ${
    gateOpen
      ? dialogueText.branches.talkHire.gateOpen
      : dialogueText.branches.talkHire.gateClosed
  }`

  const info = gateOpen ? intro : `${intro}\n${reasons.join(' · ')}`

  return {
    id: 'talkHire',
    label: dialogueText.buttons.talkHire,
    info,
    children: [
      {
        id: 'accept',
        label: offerLabel,
        enabled: gateOpen,
        closeOnEnter: true,
        onEnter: onAccept,
      },
      {
        id: 'decline',
        label: dialogueText.branches.talkHire.decline,
        closeOnEnter: true,
        onEnter: onDecline,
      },
    ],
  }
}

function isStationInPlayerOwnedBuilding(ws: Entity, player: Entity): boolean {
  const wsPos = ws.get(Position)
  if (!wsPos) return false
  for (const b of world.query(Building, Owner)) {
    if (!isPlayerOwnedBuilding(b, player)) continue
    const bld = b.get(Building)!
    if (wsPos.x < bld.x || wsPos.x >= bld.x + bld.w) continue
    if (wsPos.y < bld.y || wsPos.y >= bld.y + bld.h) continue
    return true
  }
  return false
}
