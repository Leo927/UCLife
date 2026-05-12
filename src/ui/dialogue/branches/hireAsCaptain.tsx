// Phase 6.2.D — hire-as-captain branch. Surfaced on any NPC dialog
// when the player owns at least one Ship with no `assignedCaptainId`.
// The branch opens a ship picker; clicking a ship assigns this NPC as
// its captain, charges the signing fee, and closes the dialog.
//
// Eligibility (mirrors hireAsCrew):
//   • not the player, not an Applicant, not already EmployedAsCrew
//   • not currently employed at a player-owned facility (no double-
//     dip with the talkHire branch — that one routes through
//     RecruitedTo for a faction-of-one position; this one routes
//     through EmployedAsCrew for a ship slot)
//   • the NPC's faction is 'civilian' — special-NPCs with a board /
//     manager / faction role are off-limits at this slice. (Future
//     phases: a faction NPC may opt in to captaincy via a dedicated
//     branch.)
//   • at least one ship in the fleet has assignedCaptainId === ''

import { useState } from 'react'
import {
  Character, EmployedAsCrew, IsPlayer, Money, Applicant, FactionRole, Ship,
  EntityKey, IsFlagshipMark,
} from '../../../ecs/traits'
import { getWorld } from '../../../ecs/world'
import { getShipClass } from '../../../data/ship-classes'
import { useUI } from '../../uiStore'
import { fleetConfig } from '../../../config'
import { hireAsCaptain } from '../../../systems/fleetCrew'
import { playUi } from '../../../audio/player'
import { dialogueText } from '../../../data/dialogueText'
import type { DialogueCtx, DialogueNode } from '../types'

interface CaptainTarget {
  shipKey: string
  templateId: string
  shipName: string
  isFlagship: boolean
}

function listCaptainVacancies(): CaptainTarget[] {
  const out: CaptainTarget[] = []
  const w = getWorld('playerShipInterior')
  for (const e of w.query(Ship, EntityKey)) {
    const s = e.get(Ship)!
    if (s.assignedCaptainId !== '') continue
    // Phase 6.2.G — mothballed ships are off the books; their captain
    // slot is frozen. Hide rather than disable to keep the picker short.
    if (s.mothballed) continue
    const cls = getShipClass(s.templateId)
    out.push({
      shipKey: e.get(EntityKey)!.key,
      templateId: s.templateId,
      shipName: cls.nameZh,
      isFlagship: e.has(IsFlagshipMark),
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

export function hireAsCaptainBranch(ctx: DialogueCtx): DialogueNode | null {
  if (!npcEligibleForHire(ctx)) return null
  const vacancies = listCaptainVacancies()
  if (vacancies.length === 0) return null
  return {
    id: 'hireAsCaptain',
    label: dialogueText.buttons.hireAsCaptain,
    info: dialogueText.branches.hireAsCaptain.intro
      .replace('{fee}', String(fleetConfig.hireCaptainSigningFee))
      .replace('{salary}', String(fleetConfig.captainDailySalary)),
    specialUI: () => <CaptainPicker npcCtx={ctx} />,
  }
}

function CaptainPicker({ npcCtx }: { npcCtx: DialogueCtx }) {
  const t = dialogueText.branches.hireAsCaptain
  const [vacancies, setVacancies] = useState<CaptainTarget[]>(() => listCaptainVacancies())

  const npc = npcCtx.npc
  const npcName = npc.get(Character)?.name ?? ''

  const onPick = (target: CaptainTarget) => {
    const playerWorld = getWorld('playerShipInterior')
    void playerWorld
    // Locate live entities by key (Ship in playerShipInterior; player in
    // active scene).
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
    if (!m || m.amount < fleetConfig.hireCaptainSigningFee) {
      useUI.getState().showToast(t.toastNoFunds.replace('{fee}', String(fleetConfig.hireCaptainSigningFee)))
      return
    }
    const r = hireAsCaptain(player, npc, shipEnt)
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
    setVacancies(listCaptainVacancies())
  }

  return (
    <>
      <h3>{t.title}</h3>
      <p className="hr-intro">
        {t.feeLine
          .replace('{fee}', String(fleetConfig.hireCaptainSigningFee))
          .replace('{salary}', String(fleetConfig.captainDailySalary))}
      </p>
      <ul className="dialog-options" style={{ listStyle: 'none', padding: 0 }}>
        {vacancies.map((v) => (
          <li key={v.shipKey} className="dev-row" data-hire-captain-target={v.shipKey}>
            <span className="dev-key">
              {v.shipName}
              {v.isFlagship && (
                <span style={{ marginLeft: 4, opacity: 0.7 }}>· {dialogueText.branches.fleetRoster.flagshipBadge}</span>
              )}
            </span>
            <button
              className="dialog-option"
              data-hire-captain-confirm={v.shipKey}
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
