// Phase 6.2.5.B — hire-as-pilot dialogue branch. Surface for civilian
// NPCs in the bar / city when the player has at least one MS without a
// pilot (or no MS at all but the role-flag stays exposed once the player
// owns an Ms entity, so hiring ahead of buying a second MS is allowed).
//
// Gating shape mirrors talkHire: faction rep OR opinion clears the gate.
// On accept: deduct signing fee, mark the NPC as EmployedAsPilot, route
// daily salary via the unified factionSalarySystem (which reads the
// EmployedAsPilot role alongside EmployedAsCrew).

import type { Entity } from 'koota'
import {
  Applicant, Building, Character, EmployedAsCrew, EmployedAsPilot,
  FactionRole, IsPlayer, Job, Knows, Money, Owner, Position, RecruitedTo,
  Workstation, Ms,
} from '../../../ecs/traits'
import { useUI } from '../../uiStore'
import { recruitmentConfig, fleetConfig } from '../../../config'
import { getRep } from '../../../systems/reputation'
import { applyOpinionDelta } from '../../../systems/relations'
import { useClock } from '../../../sim/clock'
import { isPlayerOwnedBuilding } from '../../../ecs/playerFaction'
import { world, getWorld } from '../../../ecs/world'
import { playUi } from '../../../audio/player'
import { dialogueText } from '../../../data/dialogueText'
import type { DialogueCtx, DialogueNode } from '../types'

const SHIP_SCENE_ID = 'playerShipInterior' as const

// Surface only when the player owns at least one Ms entity. Avoids
// dangling "hire pilot" verbs early-game before the player has anything
// to fly — once an MS exists, the verb is always reachable so the player
// can build the roster ahead of a second delivery if they want.
function playerHasAnyMs(): boolean {
  const w = getWorld(SHIP_SCENE_ID)
  for (const _ of w.query(Ms)) return true
  return false
}

export function hireAsPilotBranch(ctx: DialogueCtx): DialogueNode | null {
  const target = ctx.npc
  const player = world.queryFirst(IsPlayer)
  if (!player || target === player) return null
  if (target.has(Applicant)) return null
  if (target.has(EmployedAsCrew)) return null
  if (target.has(EmployedAsPilot)) return null

  const existingRec = target.get(RecruitedTo)
  if (existingRec && existingRec.owner === player) return null

  const fr = target.get(FactionRole)
  if (fr && fr.faction === 'anaheim') return null

  const job = target.get(Job)
  if (job?.workstation && isStationInPlayerOwnedBuilding(job.workstation, player)) {
    return null
  }

  if (!playerHasAnyMs()) return null

  const gates = recruitmentConfig.talkVerbHire
  const aeRep = getRep(player, gates.factionRepGate.faction)
  const factionRepOk = aeRep >= gates.factionRepGate.min

  const edge = target.has(Knows(player)) ? target.get(Knows(player)) : null
  const opinion = edge?.opinion ?? 0
  const opinionOk = opinion >= gates.opinionGate.min
  const gateOpen = factionRepOk || opinionOk

  const opGap = gates.opinionGate.min - opinion
  const repGap = gates.factionRepGate.min - aeRep
  if (!gateOpen && opGap > 25) return null

  const t = dialogueText.branches.hireAsPilot

  const hesitate = (): string => {
    const closerIsOpinion = opGap <= repGap
    const gap = closerIsOpinion ? opGap : repGap
    if (closerIsOpinion) {
      if (gap > 20) return t.hesitateOpinionFar
      if (gap > 10) return t.hesitateOpinionMedium
      return t.hesitateOpinionNear
    }
    if (gap > 20) return t.hesitateFactionFar
    if (gap > 10) return t.hesitateFactionMedium
    return t.hesitateFactionNear
  }

  const signingFee = fleetConfig.hirePilotSigningFee
  const dailySalary = recruitmentConfig.factionMemberDailySalary + fleetConfig.pilotSalaryBonus

  const info = gateOpen
    ? t.gateOpen
        .replace('{bonus}', String(signingFee))
        .replace('{salary}', String(dailySalary))
    : hesitate()

  const onAccept = () => {
    const m = player.get(Money)
    if (!m || m.amount < signingFee) {
      useUI.getState().showToast(t.toastNoMoney)
      return
    }
    playUi('ui.hr.accept')
    player.set(Money, { amount: m.amount - signingFee })
    const targetMoney = target.get(Money)
    if (targetMoney) {
      target.set(Money, { amount: targetMoney.amount + signingFee })
    } else {
      target.add(Money({ amount: signingFee }))
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

    if (target.has(EmployedAsPilot)) {
      target.set(EmployedAsPilot, { msKey: '' })
    } else {
      target.add(EmployedAsPilot({ msKey: '' }))
    }

    applyOpinionDelta(
      target, player, gates.hireOpinionBonus,
      { actorName: player.get(Character)?.name ?? '玩家', deedZh: '聘了我当机师' },
      useClock.getState().gameDate.getTime(),
    )

    const ch = target.get(Character)
    useUI.getState().showToast(t.toastAccepted.replace('{name}', ch?.name ?? '对方'))
    useUI.getState().setDialogNPC(null)
  }

  const children: DialogueNode[] = gateOpen
    ? [{ id: 'accept', label: t.acceptLabel, closeOnEnter: true, onEnter: onAccept }]
    : []

  return {
    id: 'hireAsPilot',
    label: dialogueText.buttons.hireAsPilot,
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
