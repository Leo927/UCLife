// Phase 6.2.D — hire-as-crew branch. Surfaced on any NPC dialog when
// the player owns at least one Ship whose crew has a vacancy
// (crewIds.length < crewRequired). The picker mirrors the captain
// branch: pick a ship, charge the signing fee, append to crewIds, close.

import { useState } from 'react'
import {
  Character, EmployedAsCrew, IsPlayer, Money, Applicant, FactionRole, Ship,
  EntityKey, IsFlagshipMark,
} from '../../../ecs/traits'
import { getWorld } from '../../../ecs/world'
import { getShipClass } from '../../../data/ship-classes'
import { useUI } from '../../uiStore'
import { fleetConfig } from '../../../config'
import { hireAsCrew, crewVacancyForShip } from '../../../systems/fleetCrew'
import { playUi } from '../../../audio/player'
import { dialogueText } from '../../../data/dialogueText'
import type { DialogueCtx, DialogueNode } from '../types'

interface CrewTarget {
  shipKey: string
  templateId: string
  shipName: string
  isFlagship: boolean
  vacancy: number
  crewMax: number
}

function listCrewVacancies(): CrewTarget[] {
  const out: CrewTarget[] = []
  const w = getWorld('playerShipInterior')
  for (const e of w.query(Ship, EntityKey)) {
    const vacancy = crewVacancyForShip(e)
    if (vacancy <= 0) continue
    const s = e.get(Ship)!
    const cls = getShipClass(s.templateId)
    out.push({
      shipKey: e.get(EntityKey)!.key,
      templateId: s.templateId,
      shipName: cls.nameZh,
      isFlagship: e.has(IsFlagshipMark),
      vacancy,
      crewMax: cls.crewMax,
    })
  }
  return out
}

function npcEligibleForHire(ctx: DialogueCtx): boolean {
  const npc = ctx.npc
  if (npc.has(IsPlayer)) return false
  if (npc.has(Applicant)) return false
  if (npc.has(EmployedAsCrew)) return false
  const fr = npc.get(FactionRole)
  if (fr && fr.faction !== 'civilian') return false
  return true
}

export function hireAsCrewBranch(ctx: DialogueCtx): DialogueNode | null {
  if (!npcEligibleForHire(ctx)) return null
  const vacancies = listCrewVacancies()
  if (vacancies.length === 0) return null
  return {
    id: 'hireAsCrew',
    label: dialogueText.buttons.hireAsCrew,
    info: dialogueText.branches.hireAsCrew.intro
      .replace('{fee}', String(fleetConfig.hireCrewSigningFee))
      .replace('{salary}', String(fleetConfig.crewDailySalary)),
    specialUI: () => <CrewPicker npcCtx={ctx} />,
  }
}

function CrewPicker({ npcCtx }: { npcCtx: DialogueCtx }) {
  const t = dialogueText.branches.hireAsCrew
  const [vacancies, setVacancies] = useState<CrewTarget[]>(() => listCrewVacancies())

  const npc = npcCtx.npc
  const npcName = npc.get(Character)?.name ?? ''

  const onPick = (target: CrewTarget) => {
    let shipEnt = null
    const sw = getWorld('playerShipInterior')
    for (const e of sw.query(Ship, EntityKey)) {
      if (e.get(EntityKey)!.key === target.shipKey) { shipEnt = e; break }
    }
    let player = null
    for (const sceneId of ['vonBraunCity', 'granadaDrydock', 'playerShipInterior'] as const) {
      const w = getWorld(sceneId)
      const p = w.queryFirst(IsPlayer)
      if (p) { player = p; break }
    }
    if (!shipEnt || !player) {
      useUI.getState().showToast(t.toastFailed)
      return
    }
    const m = player.get(Money)
    if (!m || m.amount < fleetConfig.hireCrewSigningFee) {
      useUI.getState().showToast(t.toastNoFunds.replace('{fee}', String(fleetConfig.hireCrewSigningFee)))
      return
    }
    const r = hireAsCrew(player, npc, shipEnt)
    if (!r.ok) {
      useUI.getState().showToast(`${t.toastFailed} · ${r.reason}`)
      return
    }
    playUi('ui.hr.accept')
    useUI.getState().showToast(
      t.toastHired
        .replace('{name}', npcName || '该 NPC')
        .replace('{ship}', target.shipName)
        .replace('{fee}', String(r.signingFee)),
    )
    useUI.getState().setDialogNPC(null)
    setVacancies(listCrewVacancies())
  }

  return (
    <>
      <h3>{t.title}</h3>
      <p className="hr-intro">
        {t.feeLine
          .replace('{fee}', String(fleetConfig.hireCrewSigningFee))
          .replace('{salary}', String(fleetConfig.crewDailySalary))}
      </p>
      <ul className="dialog-options" style={{ listStyle: 'none', padding: 0 }}>
        {vacancies.map((v) => (
          <li key={v.shipKey} className="dev-row" data-hire-crew-target={v.shipKey}>
            <span className="dev-key">
              {v.shipName}
              {v.isFlagship && (
                <span style={{ marginLeft: 4, opacity: 0.7 }}>· {dialogueText.branches.fleetRoster.flagshipBadge}</span>
              )}
            </span>
            <span>{t.vacancyLabel} {v.vacancy} / {v.crewMax}</span>
            <button
              className="dialog-option"
              data-hire-crew-confirm={v.shipKey}
              onClick={() => onPick(v)}
            >
              {t.pickButton}
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
