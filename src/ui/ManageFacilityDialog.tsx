// Per-facility manage dialog — opened by walking onto a 'manage' cell
// inside a player-owned facility. The cell itself is the legitimate
// cell-as-management surface for owner-control verbs (Design/social/
// diegetic-management.md). The dialog shows local-roster status, lets
// the player auto-assign idle members to vacant seats in *this*
// facility, and surfaces today's per-facility books.
//
// Cross-facility roster work continues to live on the secretary's
// talk-verb (SecretaryConversation) — this dialog is the local
// bootstrap for "I just bought this place; who works here?"

import { useState } from 'react'
import { useQuery, useQueryFirst, useTrait } from 'koota/react'
import type { Entity } from 'koota'
import {
  Building, Character, Facility, IsPlayer, Job, Owner, Workstation,
} from '../ecs/traits'
import { useUI } from './uiStore'
import { world } from '../ecs/world'
import { playUi } from '../audio/player'
import {
  assignIdleMembersToBuilding,
  buildingForStation,
  facilityRoster,
} from '../systems/secretaryRoster'
import {
  clearMemberJob, memberDisplayName, playerFactionMembers,
} from '../ecs/playerFaction'
import { getJobSpec } from '../data/jobs'
import { facilityMaintenancePerDay } from '../config'

export function ManageFacilityDialog() {
  const target = useUI((s) => s.dialogManageBuilding)
  const setTarget = useUI((s) => s.setDialogManageBuilding)
  const player = useQueryFirst(IsPlayer)
  // Subscribe to Workstation churn so the roster re-renders after assigns.
  const allStations = useQuery(Workstation)
  void allStations

  const buildingTrait = useTrait(target, Building)
  const facility = useTrait(target, Facility)
  const owner = useTrait(target, Owner)

  const [reply, setReply] = useState<string | null>(null)
  const [pickerWs, setPickerWs] = useState<Entity | null>(null)
  const [pickerJobTitle, setPickerJobTitle] = useState<string>('')

  if (!target || !player || !buildingTrait) return null

  const stillOwned = owner?.kind === 'character' && owner.entity === player
  const close = () => {
    playUi('ui.npc.close')
    setTarget(null)
    setReply(null)
    setPickerWs(null)
    setPickerJobTitle('')
  }
  const closePicker = () => {
    setPickerWs(null)
    setPickerJobTitle('')
  }

  if (!stillOwned) {
    // Ownership was lost while the dialog was open (foreclosure / sale).
    // Surface a one-line note rather than rendering a stale roster.
    return (
      <div className="status-overlay" onClick={close}>
        <div className="status-panel" onClick={(e) => e.stopPropagation()}>
          <header className="status-header">
            <h2>{buildingTrait.label} · 管理</h2>
            <button className="status-close" onClick={close} aria-label="关闭">✕</button>
          </header>
          <section className="status-section">
            <p className="dialog-response">这处设施已不再归你所有。</p>
          </section>
        </div>
      </div>
    )
  }

  const roster = facilityRoster(world, player, target)
  const vacant = roster.filter((r) => r.occupant === null)
  const occupied = roster.filter((r) => r.occupant !== null)

  const facMaint = facilityMaintenancePerDay(buildingTrait.typeId)
  const todayRevenue = facility?.revenueAcc ?? 0
  const todaySalaries = facility?.salariesAcc ?? 0
  const todayNet = todayRevenue - todaySalaries - facMaint

  const onAssign = () => {
    playUi('ui.factory-manager.accept')
    const summary = assignIdleMembersToBuilding(world, player, target)
    if (summary.assigned === 0) {
      setReply(summary.unassigned > 0
        ? `没合适岗位 · 还有${summary.unassigned}人空着，可以试试招聘代理处。`
        : '没有空岗 · 也没有闲着的成员。')
      return
    }
    setReply(`已分配${summary.assigned}人到本处岗位。`)
  }

  return (
    <div className="status-overlay" onClick={close}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>{buildingTrait.label} · 管理</h2>
          <button className="status-close" onClick={close} aria-label="关闭">✕</button>
        </header>
        <section className="status-section">
          <div className="status-meta">
            岗位 {roster.length} · 空岗 {vacant.length} · 在岗 {occupied.length}
          </div>
          <div className="status-meta">
            今日收入 ¥{todayRevenue} · 工资 ¥{todaySalaries} · 维护 ¥{facMaint} · 净 {formatSigned(todayNet)}
          </div>
          {reply && <p className="dialog-response">{reply}</p>}
        </section>
        {pickerWs ? (
          <RosterAssignPanel
            ws={pickerWs}
            jobTitle={pickerJobTitle}
            player={player}
            onClose={closePicker}
            onAssigned={(name) => {
              setReply(`${name} 已就任${pickerJobTitle}。`)
              closePicker()
            }}
          />
        ) : (
          <>
            {vacant.length > 0 && (
              <section className="status-section">
                <h3>空岗</h3>
                <ul className="manage-roster">
                  {vacant.map((r) => (
                    <li key={r.ws.id()}>
                      <span>{r.jobTitle} · 暂无人在岗</span>
                      <button
                        className="manage-roster-pick"
                        onClick={() => {
                          setPickerWs(r.ws)
                          setPickerJobTitle(r.jobTitle)
                          setReply(null)
                        }}
                      >
                        指派…
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {occupied.length > 0 && (
              <section className="status-section">
                <h3>在岗</h3>
                <ul className="manage-roster">
                  {occupied.map((r) => (
                    <li key={r.ws.id()}>{r.jobTitle} · {r.occupantName}</li>
                  ))}
                </ul>
              </section>
            )}
            <section className="status-section">
              <div className="dialog-options">
                <button
                  className="dialog-option"
                  onClick={onAssign}
                  disabled={vacant.length === 0}
                >
                  把闲人安排到本处空岗
                </button>
                <button className="dialog-option" onClick={close}>关闭</button>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function RosterAssignPanel({
  ws, jobTitle, player, onClose, onAssigned,
}: {
  ws: Entity
  jobTitle: string
  player: Entity
  onClose: () => void
  onAssigned: (name: string) => void
}) {
  void useQuery(Workstation)
  const members = playerFactionMembers(world, player)

  const assign = (m: Entity) => {
    playUi('ui.factory-manager.accept')
    const cur = ws.get(Workstation)
    if (!cur) {
      onClose()
      return
    }
    if (cur.occupant !== null && cur.occupant !== m) {
      onClose()
      return
    }
    clearMemberJob(m)
    ws.set(Workstation, { ...cur, occupant: m })
    m.set(Job, { workstation: ws, unemployedSinceMs: 0 })
    onAssigned(memberDisplayName(m))
  }

  const rows = members.map((m) => {
    const job = m.get(Job)
    let status = '闲职'
    if (job?.workstation) {
      const cw = job.workstation.get(Workstation)
      const spec = cw ? getJobSpec(cw.specId) : null
      const bld = buildingForStation(world, job.workstation)
      const blabel = bld?.get(Building)?.label ?? '设施'
      const jt = spec?.jobTitle ?? '工位'
      status = job.workstation === ws ? '已在此岗' : `现任 ${blabel}·${jt}`
    }
    return { m, status, sameSlot: job?.workstation === ws }
  })

  return (
    <section className="status-section">
      <h3>指派 · {jobTitle}</h3>
      {rows.length === 0 && (
        <p className="dialog-response">暂无可派遣的成员。</p>
      )}
      <div className="secretary-hire-list">
        {rows.map(({ m, status, sameSlot }) => {
          const ch = m.get(Character)
          return (
            <div key={m.id()} className="apt-row">
              <div className="apt-row-info">
                <div className="apt-row-name">{ch?.name ?? '?'}</div>
                <div className="apt-row-meta">{status}</div>
              </div>
              <div className="apt-row-actions">
                <button
                  className="apt-row-buy"
                  onClick={() => assign(m)}
                  disabled={sameSlot}
                >
                  派去
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <div className="dialog-options">
        <button className="dialog-option" onClick={onClose}>返回</button>
      </div>
    </section>
  )
}

function formatSigned(n: number): string {
  if (n === 0) return '¥0'
  return n > 0 ? `+¥${n}` : `-¥${Math.abs(n)}`
}
