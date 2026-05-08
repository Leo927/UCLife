// Phase 5.5.4 recruiter modal. Mirrors SecretaryDialog: a single mount
// point routed by useUI.dialogRecruiterStation, branching on ownership +
// occupant.
//
//   • State-owned (pre-purchase) → blurb pointing the player at the realtor
//   • Player-owned + vacant       → install-recruiter list
//   • Player-owned + seated       → criteria + applicant lobby + roll log

import { useState } from 'react'
import { useQuery, useQueryFirst, useTrait } from 'koota/react'
import type { Entity } from 'koota'
import {
  Applicant, Building, Character, IsPlayer, Owner, Recruiter, Workstation,
} from '../ecs/traits'
import { useUI } from './uiStore'
import { world } from '../ecs/world'
import { Portrait } from '../render/portrait/react/Portrait'
import { playUi } from '../audio/player'
import { isPlayerOwnedBuilding } from '../ecs/playerFaction'
import {
  eligibleRecruiterHires, installRecruiter, lobbyForStation,
  manualAcceptApplicant, rejectApplicant,
} from '../systems/recruitment'
import { buildingForStation } from '../systems/secretaryRoster'
import { recruitmentConfig, skillsConfig } from '../config'
import type { SkillId } from '../character/skills'

const SKILL_OPTIONS: SkillId[] = recruitmentConfig.skillsRolled

export function RecruiterDialog() {
  const station = useUI((s) => s.dialogRecruiterStation)
  const setStation = useUI((s) => s.setDialogRecruiterStation)
  const ws = useTrait(station, Workstation)
  const player = useQueryFirst(IsPlayer)
  // Re-evaluate ownership + occupant on changes.
  void useQuery(Building, Owner)
  void useQuery(Workstation)

  if (!station || !ws || !player) return null
  const building = buildingForStation(world, station)
  const playerOwned = building ? isPlayerOwnedBuilding(building, player) : false
  const buildingLabel = building?.get(Building)?.label ?? '招聘代理处'

  const close = () => {
    playUi('ui.npc.close')
    setStation(null)
  }

  return (
    <div className="status-overlay" onClick={close}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>{buildingLabel} · 招聘办公桌</h2>
          <button className="status-close" onClick={close} aria-label="关闭">✕</button>
        </header>
        {!playerOwned && (
          <section className="status-section">
            <p className="hr-intro">这张桌子还不属于你 · 先去房产中介把房子买下来。</p>
          </section>
        )}
        {playerOwned && ws.occupant === null && (
          <RecruiterHireList station={station} onClose={close} />
        )}
        {playerOwned && ws.occupant !== null && (
          <RecruiterVerbs station={station} onClose={close} />
        )}
      </div>
    </div>
  )
}

function RecruiterHireList({ station, onClose }: { station: Entity; onClose: () => void }) {
  const [filter, setFilter] = useState('')
  const candidates = eligibleRecruiterHires(world)
  const view = filter
    ? candidates.filter((c) => (c.get(Character)?.name ?? '').includes(filter))
    : candidates

  const hire = (e: Entity) => {
    if (!installRecruiter(station, e)) {
      useUI.getState().showToast('这个岗位已经有人了')
      return
    }
    playUi('ui.hr.accept')
    const name = e.get(Character)?.name ?? '一名招聘专员'
    useUI.getState().showToast(`${name}已上岗 · 月薪 ¥130 / 班`)
    onClose()
  }

  return (
    <section className="status-section conversation-extension">
      <h3>聘请招聘专员</h3>
      <p className="hr-intro">招聘专员负责把申请者带进办公室——薪水从faction资金里发。</p>
      <input
        type="text"
        className="dev-input"
        style={{ width: '100%', marginBottom: 8 }}
        placeholder="按名字筛选"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {view.length === 0 && <p className="hr-intro">城里没有空闲的市民可雇。</p>}
      <div className="secretary-hire-list">
        {view.slice(0, 12).map((c) => {
          const ch = c.get(Character)
          return (
            <div key={c.id()} className="apt-row">
              <div className="npc-dialog-portrait" style={{ width: 64, marginRight: 8 }}>
                <Portrait entity={c} renderer="revamp" width={64} height={84} />
              </div>
              <div className="apt-row-info">
                <div className="apt-row-name">{ch?.name ?? '?'}</div>
                <div className="apt-row-meta">{ch?.title ?? '市民'}</div>
              </div>
              <div className="apt-row-actions">
                <button className="apt-row-buy" onClick={() => hire(c)}>聘用</button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function RecruiterVerbs({ station, onClose }: { station: Entity; onClose: () => void }) {
  const player = useQueryFirst(IsPlayer)!
  const wsTrait = useTrait(station, Workstation)
  const recTrait = useTrait(station, Recruiter)
  // Subscribe so accept/reject mutations re-render the lobby.
  void useQuery(Applicant)

  const recruiter = wsTrait?.occupant ?? null
  const recInfo = recruiter?.get(Character)
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

  const criteriaLabel = (() => {
    const c = recTrait?.criteria
    if (!c || !c.skill) return '无筛选 · 所有申请排队等审'
    const label = skillsConfig.catalog[c.skill]?.label ?? c.skill
    return `自动收${label} Lv ${c.minLevel} +`
  })()

  return (
    <section className="status-section conversation-extension">
      <h3>{recInfo?.name ?? '招聘专员'} · {recInfo?.title ?? '招聘专员'}</h3>
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
