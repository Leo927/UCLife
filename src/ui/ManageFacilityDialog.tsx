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
import { Building, Facility, IsPlayer, Owner, Workstation } from '../ecs/traits'
import { useUI } from './uiStore'
import { world } from '../ecs/world'
import { playUi } from '../audio/player'
import {
  assignIdleMembersToBuilding,
  facilityRoster,
} from '../systems/secretaryRoster'
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

  if (!target || !player || !buildingTrait) return null

  const stillOwned = owner?.kind === 'character' && owner.entity === player
  const close = () => {
    playUi('ui.npc.close')
    setTarget(null)
    setReply(null)
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
        {vacant.length > 0 && (
          <section className="status-section">
            <h3>空岗</h3>
            <ul className="manage-roster">
              {vacant.map((r) => (
                <li key={r.ws.id()}>{r.jobTitle} · 暂无人在岗</li>
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
      </div>
    </div>
  )
}

function formatSigned(n: number): string {
  if (n === 0) return '¥0'
  return n > 0 ? `+¥${n}` : `-¥${Math.abs(n)}`
}
