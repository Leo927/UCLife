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
import type { FactionId } from '../../../config'
import { dialogueText } from '../../../data/dialogueText'
import type { DialogueCtx, DialogueNode } from '../types'

const SKILL_OPTIONS: SkillId[] = recruitmentConfig.skillsRolled

// Phase 6.4.B — faction lean display labels (zh-CN).
const FACTION_LEAN_LABELS: Partial<Record<FactionId, string>> = {
  federation: '联邦',
  zeon: '吉翁',
  anaheim: '阿纳海姆',
  civilian: '中立',
}

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

  const [factionLean, setFactionLean] = useState<FactionId | null>(
    recTrait?.criteria.factionLean ?? null,
  )

  const setCriteria = (skill: SkillId | null, minLevel: number) => {
    playUi('ui.factory-manager.accept')
    if (!recTrait) return
    station.set(Recruiter, {
      ...recTrait,
      criteria: { skill, minLevel, factionLean, autoAccept: skill !== null || factionLean !== null },
    })
    if (skill === null && factionLean === null) {
      setReply(dialogueText.branches.recruiter.replyNoFilter)
    } else {
      const skillPart = skill ? `${skillsConfig.catalog[skill]?.label ?? skill} Lv ${minLevel} 以上` : ''
      const leanPart = factionLean ? `偏向${FACTION_LEAN_LABELS[factionLean] ?? factionLean}` : ''
      const parts = [skillPart, leanPart].filter(Boolean).join('、')
      setReply(`明白——${parts}的，我直接收下；不符合的让你过目。`)
    }
  }

  const toggleFactionLean = (lean: FactionId) => {
    playUi('ui.factory-manager.accept')
    const next = factionLean === lean ? null : lean
    setFactionLean(next)
    if (!recTrait) return
    // Immediately apply faction lean change to the station criteria,
    // preserving the existing skill filter.
    const cur = recTrait.criteria
    station.set(Recruiter, {
      ...recTrait,
      criteria: {
        skill: cur.skill,
        minLevel: cur.minLevel,
        factionLean: next,
        autoAccept: cur.skill !== null || next !== null,
      },
    })
    const leanLabel = next ? FACTION_LEAN_LABELS[next] ?? next : null
    setReply(leanLabel ? `好，会优先找${leanLabel}倾向的人。` : dialogueText.branches.recruiter.replyNoFilter)
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
    if (!c) return '无筛选 · 所有申请排队等审'
    const parts: string[] = []
    if (c.skill) parts.push(`${skillsConfig.catalog[c.skill]?.label ?? c.skill} Lv ${c.minLevel}+`)
    if (c.factionLean) parts.push(`偏${FACTION_LEAN_LABELS[c.factionLean] ?? c.factionLean}`)
    return parts.length > 0 ? `自动收 ${parts.join('·')}` : '无筛选 · 所有申请排队等审'
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

      <div className="dialog-options" style={{ marginTop: 6 }}>
        <span style={{ fontSize: '0.85em', opacity: 0.7, marginRight: 6 }}>倾向筛选：</span>
        {(recruitmentConfig.factionLeanPool as FactionId[]).map((lean) => (
          <button
            key={lean}
            className={`dialog-option${factionLean === lean ? ' dialog-option-selected' : ''}`}
            onClick={() => toggleFactionLean(lean)}
          >
            {FACTION_LEAN_LABELS[lean] ?? lean}
          </button>
        ))}
        {factionLean !== null && (
          <button className="dialog-option" onClick={() => setFactionLean(null)}>
            不限倾向
          </button>
        )}
      </div>

      <h3 style={{ marginTop: 12 }}>{dialogueText.branches.recruiter.lobbyHeader}</h3>
      {lobby.length === 0 && <p className="hr-intro">{dialogueText.branches.recruiter.lobbyEmpty}</p>}
      <div className="secretary-hire-list">
        {lobby.map(({ applicant, data }) => (
          <div key={applicant.id()} className="apt-row">
            <div className="npc-dialog-portrait" style={{ width: 64, marginRight: 8 }}>
              <Portrait entity={applicant} width={64} height={84} />
            </div>
            <div className="apt-row-info">
              <div className="apt-row-name">{data.name}</div>
              <div className="apt-row-meta">{data.summary}</div>
              {data.factionLean && (
                <div className="apt-row-meta" style={{ fontSize: '0.8em', opacity: 0.75 }}>
                  {FACTION_LEAN_LABELS[data.factionLean as FactionId] ?? data.factionLean}
                  倾向
                </div>
              )}
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
