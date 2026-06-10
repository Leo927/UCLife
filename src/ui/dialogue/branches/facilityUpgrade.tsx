// Phase 5.5.6 — facility-tier manage surface (Design/social/facility-tiers.md
// § Surface: the manage-interactable). Two anchors, one panel:
//   • worker-on-duty at a player-owned facility — "想聊聊升级。"
//   • secretary at the faction office — same panel behind a facility picker,
//     so an empty-seat (or in-downtime) facility never dead-ends.

import { useState } from 'react'
import { useQuery, useQueryFirst } from 'koota/react'
import type { Entity } from 'koota'
import {
  Building, FacilityTiers, IsPlayer, Job, Owner,
} from '../../../ecs/traits'
import { world } from '../../../ecs/world'
import {
  buildingForStation, findOwnedFactionOfficeStation,
} from '../../../systems/secretaryRoster'
import { isPlayerOwnedBuilding, playerOwnedBuildings } from '../../../ecs/playerFaction'
import {
  startTierUpgrade, tierPanelView, type TierRowView,
} from '../../../systems/facilityTiers'
import { facilityTierLadder } from '../../../data/facilityTypes'
import { useUI } from '../../uiStore'
import { playUi } from '../../../audio/player'
import type { DialogueCtx, DialogueNode } from '../types'

// Worker-anchored entry: the on-duty worker at any player-owned facility
// whose class has an authored tier ladder.
export function facilityUpgradeBranch(ctx: DialogueCtx): DialogueNode | null {
  const worker = ctx.npc
  const player = world.queryFirst(IsPlayer)
  if (!player || worker === player) return null
  const job = worker.get(Job)
  if (!job?.workstation) return null
  const ws = job.workstation
  const building = buildingForStation(world, ws)
  if (!building) return null
  if (!isPlayerOwnedBuilding(building, player)) return null
  if (ws === findOwnedFactionOfficeStation(world, player)) return null
  if (!facilityTierLadder(building.get(Building)?.typeId ?? '')) return null
  return {
    id: 'facilityUpgrade',
    label: '想聊聊升级。',
    info: (building.get(Building)?.label ?? '设施') + ' · 设施升级',
    specialUI: () => <FacilityTierPanel building={building} />,
  }
}

// Secretary fallback: schedule upgrades for any owned facility with a
// ladder, even when its seat is vacant or already in downtime.
export function secretaryUpgradeBranch(ctx: DialogueCtx): DialogueNode | null {
  if (!ctx.roles.isSecretaryOnDuty) return null
  const player = world.queryFirst(IsPlayer)
  if (!player) return null
  const candidates = playerOwnedBuildings(world, player)
    .filter((b) => facilityTierLadder(b.get(Building)?.typeId ?? ''))
  if (candidates.length === 0) return null
  return {
    id: 'secretaryUpgrade',
    label: '安排设施升级。',
    info: '设施升级',
    specialUI: () => <FacilityPickerPanel />,
  }
}

function FacilityPickerPanel() {
  const player = useQueryFirst(IsPlayer)
  void useQuery(Building, Owner)
  const [picked, setPicked] = useState<Entity | null>(null)
  if (!player) return null

  if (picked) {
    return (
      <>
        <FacilityTierPanel building={picked} />
        <button className="dialog-option" onClick={() => setPicked(null)}>返回设施列表</button>
      </>
    )
  }

  const candidates = playerOwnedBuildings(world, player)
    .filter((b) => facilityTierLadder(b.get(Building)?.typeId ?? ''))
  return (
    <>
      <h3>设施升级</h3>
      {candidates.length === 0 && <p className="hr-intro">名下没有可升级的设施。</p>}
      <div className="dialog-options">
        {candidates.map((b, i) => (
          <button key={i} className="dialog-option" onClick={() => { playUi('ui.factory-manager.accept'); setPicked(b) }}>
            {b.get(Building)?.label ?? '设施'}
          </button>
        ))}
      </div>
    </>
  )
}

function FacilityTierPanel({ building }: { building: Entity }) {
  // Re-render after startTierUpgrade attaches/updates the trait and after
  // the daily countdown writes daysRemaining.
  void useQuery(FacilityTiers)
  const [, setNonce] = useState(0)

  const rows = tierPanelView(world, building)
  const label = building.get(Building)?.label ?? '设施'

  const onStart = (row: TierRowView) => {
    playUi('ui.factory-manager.accept')
    const ok = window.confirm(
      `${row.knobLabelZh} 升级到 ${row.tier} 级：花费 ¥${row.creditCost}，停业 ${row.downtimeDays} 天。确认？`,
    )
    if (!ok) return
    const res = startTierUpgrade(world, building, row.knob, row.tier)
    if (!res.ok) {
      useUI.getState().showToast(
        res.reason === 'fund' ? '资金不足，升级没法开工。' : '现在没法开始这项升级。',
      )
    } else {
      useUI.getState().showToast(`「${label}」的 ${row.knobLabelZh} 升级已开工。`)
    }
    setNonce((n) => n + 1)
  }

  return (
    <>
      <h3>{label} · 设施升级</h3>
      <div className="secretary-hire-list" data-testid="facility-tier-panel">
        {rows.map((row, i) => (
          <div key={i} className={`apt-row${row.state === 'locked' ? ' faded' : ''}`}>
            <div className="apt-row-info">
              <div className="apt-row-name">
                {row.state === 'done' && '✓ '}{row.knobLabelZh} {row.tier} 级
              </div>
              <div className="apt-row-meta">
                {row.state === 'locked' && row.gateTextZh}
                {row.state === 'inProgress' && `升级中 — 还剩 ${row.daysRemaining} 天`}
                {row.state === 'available'
                  && `¥${row.creditCost} · 停业 ${row.downtimeDays} 天${row.affordable ? '' : ' · 资金不足'}`}
                {row.state === 'done' && '已建成'}
              </div>
            </div>
            {row.state === 'available' && (
              <div className="apt-row-actions">
                <button
                  className="apt-row-buy"
                  disabled={!row.affordable}
                  onClick={() => onStart(row)}
                >确认升级</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
