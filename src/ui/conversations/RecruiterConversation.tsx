// Recruiter's inline dialog (rendered in NPCDialog when the player chats
// up the on-duty recruiter at a player-owned recruit office). The desk
// behind her carries no Interactable trait — it is scenery only — per
// the worker-not-workstation rule in Design/social/diegetic-management.md.
//
// The install (vacant-seat hire) route used to live on the desk's modal
// and is now closed by the diegetic discipline: bootstrap install
// happens via the per-facility manage cell (ManageFacilityDialog) or
// via a talk-verb hire on a civilian.

import { useState } from 'react'
import { useQuery, useQueryFirst, useTrait } from 'koota/react'
import type { Entity } from 'koota'
import {
  Applicant, Character, IsPlayer, Job, Recruiter, Workstation,
} from '../../ecs/traits'
import { useUI } from '../uiStore'
import { world } from '../../ecs/world'
import { Portrait } from '../../render/portrait/react/Portrait'
import { playUi } from '../../audio/player'
import {
  lobbyForStation, manualAcceptApplicant, rejectApplicant,
} from '../../systems/recruitment'
import { recruitmentConfig, skillsConfig } from '../../config'
import type { SkillId } from '../../character/skills'

const SKILL_OPTIONS: SkillId[] = recruitmentConfig.skillsRolled

export function RecruiterConversation({ recruiter }: { recruiter: Entity }) {
  const player = useQueryFirst(IsPlayer)!
  const recInfo = useTrait(recruiter, Character)
  const recJob = useTrait(recruiter, Job)
  // Subscribe so accept/reject mutations re-render the lobby.
  void useQuery(Applicant)

  const station = recJob?.workstation ?? null
  const recTrait = useTrait(station, Recruiter)
  if (!station) return null

  const lobby = lobbyForStation(world, station)
  const [reply, setReply] = useState<string | null>(null)

  const setCriteria = (skill: SkillId | null, minLevel: number) => {
    playUi('ui.factory-manager.accept')
    if (!recTrait) return
    station.set(Recruiter, {
      ...recTrait,
      criteria: { skill, minLevel, autoAccept: skill !== null },
    })
    if (skill === null) {
      setReply('好——所有申请者都先排队，我等你看过再说。')
    } else {
      const label = skillsConfig.catalog[skill]?.label ?? skill
      setReply(`明白——以后${label} Lv ${minLevel} 以上的，我直接收下；不够的让你过目。`)
    }
  }

  const onAccept = (applicant: Entity) => {
    playUi('ui.hr.accept')
    if (manualAcceptApplicant(world, applicant, player)) {
      const name = applicant.get(Character)?.name ?? '一名应聘者'
      useUI.getState().showToast(`${name}已加入faction`)
    }
  }

  const onReject = (applicant: Entity) => {
    playUi('ui.npc.farewell')
    if (rejectApplicant(applicant)) {
      useUI.getState().showToast('已让对方离开')
    }
  }

  const onClose = () => {
    playUi('ui.npc.close')
    useUI.getState().setDialogNPC(null)
  }

  const criteriaLabel = (() => {
    const c = recTrait?.criteria
    if (!c || !c.skill) return '无筛选 · 所有申请排队等审'
    const label = skillsConfig.catalog[c.skill]?.label ?? c.skill
    return `自动收${label} Lv ${c.minLevel} +`
  })()

  // Verify the station still binds — the seated recruiter may have
  // been fired in the same session, in which case the talk-verb is
  // stale. Defensive guard: bail rather than render a half-broken UI.
  const wsTrait = station.get(Workstation)
  if (!wsTrait || wsTrait.occupant !== recruiter) return null

  return (
    <section className="status-section conversation-extension">
      <h3>{recInfo?.name ?? '招聘专员'} · 招聘专员</h3>
      <div className="hr-intro">
        当前条件：{criteriaLabel} · 大堂 {lobby.length}/{recruitmentConfig.lobbyCapacity}
      </div>
      {reply && <p className="dialog-response" style={{ whiteSpace: 'pre-line' }}>{reply}</p>}

      <div className="dialog-options">
        <button className="dialog-option" onClick={() => setCriteria(null, 0)}>不要筛选 · 我自己看</button>
        {SKILL_OPTIONS.map((sid) => (
          <button
            key={sid}
            className="dialog-option"
            onClick={() => setCriteria(sid, 25)}
          >
            找{skillsConfig.catalog[sid].label} · 25 +
          </button>
        ))}
      </div>

      <h3 style={{ marginTop: 12 }}>大堂里的申请者</h3>
      {lobby.length === 0 && <p className="hr-intro">现在没有应聘者在等。</p>}
      <div className="secretary-hire-list">
        {lobby.map(({ applicant, data }) => (
          <div key={applicant.id()} className="apt-row">
            <div className="npc-dialog-portrait" style={{ width: 64, marginRight: 8 }}>
              <Portrait entity={applicant} renderer="revamp" width={64} height={84} />
            </div>
            <div className="apt-row-info">
              <div className="apt-row-name">{data.name}</div>
              <div className="apt-row-meta">{data.summary}</div>
            </div>
            <div className="apt-row-actions">
              <button className="apt-row-buy" onClick={() => onAccept(applicant)}>录用</button>
              <button className="apt-row-buy" onClick={() => onReject(applicant)}>婉拒</button>
            </div>
          </div>
        ))}
      </div>

      <div className="dialog-options" style={{ marginTop: 8 }}>
        <button className="dialog-option" onClick={onClose}>再见</button>
      </div>
    </section>
  )
}
