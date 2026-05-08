import { useState } from 'react'
import { useQuery, useQueryFirst } from 'koota/react'
import type { Entity } from 'koota'
import {
  Building, Character, IsPlayer, Job, Owner, Workstation,
} from '../../../ecs/traits'
import { useUI } from '../../uiStore'
import { world } from '../../../ecs/world'
import {
  buildingForStation, findOwnedFactionOfficeStation,
} from '../../../systems/secretaryRoster'
import {
  clearMemberJob, idlePlayerFactionMembers, isPlayerOwnedBuilding,
  memberDisplayName, playerFactionMembers,
} from '../../../ecs/playerFaction'
import { getJobSpec } from '../../../data/jobs'
import { playUi } from '../../../audio/player'
import { dialogueText } from '../../../data/dialogueText'
import type { DialogueCtx, DialogueNode } from '../types'

export function jobSiteBranch(ctx: DialogueCtx): DialogueNode | null {
  const worker = ctx.npc
  const job = worker.get(Job)
  if (!job?.workstation) return null
  const ws = job.workstation
  const building = buildingForStation(world, ws)
  if (!building) return null
  // We don't have a player ref here (ctx is per-NPC) — fetch via the world
  // query against IsPlayer in the SpecialUI component. The branch shows
  // when the worker's station is in *some* player-owned building. The
  // ownership check repeats the same logic the panel does.
  return {
    id: 'jobSite',
    label: dialogueText.buttons.jobSite,
    info: (building.get(Building)?.label ?? '') + ' · ' + (getJobSpec(ws.get(Workstation)?.specId ?? '')?.jobTitle ?? '工位'),
    specialUI: () => <JobSitePanel worker={worker} />,
  }
}

function JobSitePanel({ worker }: { worker: Entity }) {
  const player = useQueryFirst(IsPlayer)
  const job = worker.get(Job)
  void useQuery(Workstation)
  void useQuery(Owner)
  const [browseRoster, setBrowseRoster] = useState(false)

  if (!player || !job?.workstation) return null
  const ws = job.workstation
  const wsTrait = ws.get(Workstation)
  if (!wsTrait) return null

  const building = buildingForStation(world, ws)
  if (!building) return null
  if (!isPlayerOwnedBuilding(building, player)) return null

  if (worker === player) return null
  const secStation = findOwnedFactionOfficeStation(world, player)
  if (ws === secStation) return null

  const spec = getJobSpec(wsTrait.specId)
  const buildingLabel = building.get(Building)?.label ?? '设施'

  const onFire = () => {
    playUi('ui.npc.farewell')
    clearMemberJob(worker)
    useUI.getState().showToast(`${memberDisplayName(worker)} 已离岗。`)
    useUI.getState().setDialogNPC(null)
  }

  const onReplace = () => {
    playUi('ui.factory-manager.accept')
    const idle = idlePlayerFactionMembers(world, player)
    const candidate = idle.find((m) => m !== worker)
    if (!candidate) {
      useUI.getState().showToast('没有空闲成员可顶替。')
      return
    }
    const cur = ws.get(Workstation)!
    clearMemberJob(worker)
    clearMemberJob(candidate)
    ws.set(Workstation, { ...cur, occupant: candidate })
    candidate.set(Job, { workstation: ws, unemployedSinceMs: 0 })
    useUI.getState().showToast(
      `${memberDisplayName(candidate)} 已接替 ${memberDisplayName(worker)} 的岗位。`,
    )
    useUI.getState().setDialogNPC(null)
  }

  return (
    <>
      <h3>{buildingLabel} · {spec?.jobTitle ?? '工位'}</h3>
      <div className="hr-intro">
        当前: {memberDisplayName(worker)}{spec ? ` · 月薪 ¥${spec.wage}` : ''}
      </div>
      {!browseRoster && (
        <div className="dialog-options">
          <button className="dialog-option" onClick={onFire}>{dialogueText.branches.jobSite.fire}</button>
          <button className="dialog-option" onClick={onReplace}>{dialogueText.branches.jobSite.replaceFromIdle}</button>
          <button className="dialog-option" onClick={() => setBrowseRoster(true)}>
            {dialogueText.branches.jobSite.pickFromAll}
          </button>
        </div>
      )}
      {browseRoster && (
        <RosterPicker
          worker={worker}
          ws={ws}
          onClose={() => setBrowseRoster(false)}
          onAssign={() => {
            useUI.getState().setDialogNPC(null)
          }}
        />
      )}
    </>
  )
}

function RosterPicker({
  worker, ws, onClose, onAssign,
}: {
  worker: Entity
  ws: Entity
  onClose: () => void
  onAssign: () => void
}) {
  const player = useQueryFirst(IsPlayer)!
  const members = playerFactionMembers(world, player).filter((m) => m !== worker)

  const assign = (m: Entity) => {
    playUi('ui.factory-manager.accept')
    const cur = ws.get(Workstation)!
    clearMemberJob(worker)
    clearMemberJob(m)
    ws.set(Workstation, { ...cur, occupant: m })
    m.set(Job, { workstation: ws, unemployedSinceMs: 0 })
    useUI.getState().showToast(
      `${memberDisplayName(m)} 已接替 ${memberDisplayName(worker)} 的岗位。`,
    )
    onAssign()
  }

  return (
    <div>
      <p className="hr-intro">{dialogueText.branches.jobSite.pickIntro}</p>
      {members.length === 0 && <p className="hr-intro">{dialogueText.branches.jobSite.pickEmpty}</p>}
      <div className="secretary-hire-list">
        {members.map((m) => {
          const ch = m.get(Character)
          return (
            <div key={m.id()} className="apt-row">
              <div className="apt-row-info">
                <div className="apt-row-name">{ch?.name ?? '?'}</div>
                <div className="apt-row-meta">{ch?.title ?? '市民'}</div>
              </div>
              <div className="apt-row-actions">
                <button className="apt-row-buy" onClick={() => assign(m)}>派去</button>
              </div>
            </div>
          )
        })}
      </div>
      <button className="dialog-option" onClick={onClose}>返回</button>
    </div>
  )
}
