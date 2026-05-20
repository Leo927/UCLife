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
  Applicant, Building, Character, EmployedAsCrew, FactionRole, IsPlayer, Job, Knows,
  Money, Owner, Position, RecruitedTo, Workstation,
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
  // Already on one of the player's ships — no rehire branch surfaces.
  if (target.has(EmployedAsCrew)) return null
  // Already a faction member of this player — the talkHire branch is
  // the hire-into-faction entry point; for re-assignment, go through
  // the fleet roster's per-ship crew picker.
  const existingRec = target.get(RecruitedTo)
  if (existingRec && existingRec.owner === player) return null

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

  const opGap = gates.opinionGate.min - opinion
  const repGap = gates.factionRepGate.min - aeRep

  // Hard-cutoff: both gates well below threshold — branch doesn't even
  // surface, the NPC's not in a place to consider the conversation.
  if (!gateOpen && opGap > 25) return null

  const t = dialogueText.branches.talkHire

  // Whichever gate is closer to clearing drives the NPC's hesitation
  // line — that's the path of least resistance the player can work on.
  // Tier by gap size: the further the NPC is from saying yes, the more
  // distant their language.
  const hesitate = (): string => {
    const closerIsOpinion = opGap <= repGap
    const gap = closerIsOpinion ? opGap : repGap
    const table = closerIsOpinion ? t.hesitateOpinion : t.hesitateFaction
    if (gap > 20) return table.far
    if (gap > 10) return table.medium
    return table.near
  }

  const info = gateOpen
    ? t.gateOpen
        .replace('{bonus}', String(gates.signingBonus))
        .replace('{salary}', String(recruitmentConfig.factionMemberDailySalary))
    : hesitate()

  const onAccept = () => {
    const m = player.get(Money)
    if (!m || m.amount < gates.signingBonus) {
      useUI.getState().showToast(t.toastNoMoney)
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
    useUI.getState().showToast(t.toastAccepted.replace('{name}', ch?.name ?? '对方'))
    useUI.getState().setDialogNPC(null)
  }

  // When the gate is closed the player has no proposal to make — the
  // NPC's line carries the rejection and the runner's 返回 button is
  // the only way out. When open, a single diegetic "yes" leaf accepts;
  // the signing-bonus amount is voiced inside the NPC's line, not as a
  // separate label.
  const children: DialogueNode[] = gateOpen
    ? [{ id: 'accept', label: t.acceptLabel, closeOnEnter: true, onEnter: onAccept }]
    : []

  return {
    id: 'talkHire',
    label: dialogueText.buttons.talkHire,
    info,
    children,
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
