import { useState } from 'react'
import { useQuery, useQueryFirst, useTrait } from 'koota/react'
import type { Entity } from 'koota'
import {
  Applicant, Character, IsPlayer, Job, Recruiter, Workstation,
} from '../../../ecs/traits'
import { useUI } from '../../uiStore'
import { world } from '../../../ecs/world'
import { Portrait } from '../../../render/portrait/react/Portrait'
import { playUi } from '../../../audio/player'
import {
  lobbyForStation, manualAcceptApplicant, rejectApplicant,
} from '../../../systems/recruitment'
import { recruitmentConfig, skillsConfig } from '../../../config'
import type { SkillId } from '../../../character/skills'
import { dialogueText } from '../../../data/dialogueText'
import type { DialogueCtx, DialogueNode } from '../types'

const SKILL_OPTIONS: SkillId[] = recruitmentConfig.skillsRolled

export function recruiterBranch(ctx: DialogueCtx): DialogueNode | null {
  if (!ctx.roles.isRecruiterOnDuty) return null
  return {
    id: 'recruiter',
    label: dialogueText.buttons.recruiter,
    info: (ctx.npc.get(Character)?.name ?? '招聘专员') + dialogueText.branches.recruiter.titleSuffix,
    specialUI: () => <RecruiterPanel recruiter={ctx.npc} />,
  }
}

function RecruiterPanel({ recruiter }: { recruiter: Entity }) {
  const player = useQueryFirst(IsPlayer)!
  const recInfo = useTrait(recruiter, Character)
  const recJob = useTrait(recruiter, Job)
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
      setReply(dialogueText.branches.recruiter.replyNoFilter)
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

  const criteriaLabel = (() => {
    const c = recTrait?.criteria
    if (!c || !c.skill) return '无筛选 · 所有申请排队等审'
    const label = skillsConfig.catalog[c.skill]?.label ?? c.skill
    return `自动收${label} Lv ${c.minLevel} +`
  })()

  const wsTrait = station.get(Workstation)
  if (!wsTrait || wsTrait.occupant !== recruiter) return null

  return (
    <>
      <h3>{recInfo?.name ?? '招聘专员'}{dialogueText.branches.recruiter.titleSuffix}</h3>
      <div className="hr-intro">
        当前条件：{criteriaLabel} · 大堂 {lobby.length}/{recruitmentConfig.lobbyCapacity}
      </div>
      {reply && <p className="dialog-response" style={{ whiteSpace: 'pre-line' }}>{reply}</p>}

      <div className="dialog-options">
        <button className="dialog-option" onClick={() => setCriteria(null, 0)}>
          {dialogueText.branches.recruiter.noFilter}
        </button>
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

      <h3 style={{ marginTop: 12 }}>{dialogueText.branches.recruiter.lobbyHeader}</h3>
      {lobby.length === 0 && <p className="hr-intro">{dialogueText.branches.recruiter.lobbyEmpty}</p>}
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
    </>
  )
}
