// Phase 5.5.3 secretary modal. Two modes share one mount point keyed by
// the workstation entity in useUI.dialogSecretaryStation:
//
//   • Vacant + player-owned building → install-secretary list (pick a
//     civilian; they take the seat at the agreed wage).
//   • Seated secretary + player-owned → consultative verbs (roster /
//     books / sideways / restructure).
//
// Anything else (state-owned, faction-owned, vacant non-player-owned)
// renders a low-key blurb so the player still sees an affordance.

import { useState } from 'react'
import { useQuery, useQueryFirst, useTrait } from 'koota/react'
import {
  Building, Character, IsPlayer, Owner, Workstation,
} from '../ecs/traits'
import { useUI } from './uiStore'
import { world } from '../ecs/world'
import { Portrait } from '../render/portrait/react/Portrait'
import { playUi } from '../audio/player'
import { isPlayerOwnedBuilding } from '../ecs/playerFaction'
import {
  assignBeds,
  assignIdleMembers,
  bookSummary,
  buildingForStation,
  eligibleSecretaryHires,
  factionStatus,
  installSecretary,
  sidewaysReport,
} from '../systems/secretaryRoster'

export function SecretaryDialog() {
  const station = useUI((s) => s.dialogSecretaryStation)
  const setStation = useUI((s) => s.setDialogSecretaryStation)
  const ws = useTrait(station, Workstation)
  const player = useQueryFirst(IsPlayer)
  // Re-evaluate ownership + occupant on changes — koota subscribes via
  // these read hooks so the modal flips between modes without remount.
  void useQuery(Building, Owner)
  void useQuery(Workstation)

  if (!station || !ws || !player) return null
  const building = buildingForStation(world, station)
  const playerOwned = building ? isPlayerOwnedBuilding(building, player) : false
  const buildingLabel = building?.get(Building)?.label ?? 'Faction办公室'

  const close = () => {
    playUi('ui.npc.close')
    setStation(null)
  }

  return (
    <div className="status-overlay" onClick={close}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>{buildingLabel} · 秘书办公桌</h2>
          <button className="status-close" onClick={close} aria-label="关闭">✕</button>
        </header>
        {!playerOwned && (
          <section className="status-section">
            <p className="hr-intro">这张桌子还不属于你 · 先去房产中介把房子买下来。</p>
          </section>
        )}
        {playerOwned && ws.occupant === null && (
          <SecretaryHireList station={station} onClose={close} />
        )}
        {playerOwned && ws.occupant !== null && (
          <SecretaryVerbs secretary={ws.occupant} onClose={close} />
        )}
      </div>
    </div>
  )
}

import type { Entity } from 'koota'

function SecretaryHireList({ station, onClose }: { station: Entity; onClose: () => void }) {
  const [filter, setFilter] = useState('')
  const candidates = eligibleSecretaryHires(world)
  const view = filter
    ? candidates.filter((c) => (c.get(Character)?.name ?? '').includes(filter))
    : candidates

  const hire = (e: Entity) => {
    if (!installSecretary(station, e)) {
      useUI.getState().showToast('这个岗位已经有人了')
      return
    }
    playUi('ui.hr.accept')
    const name = e.get(Character)?.name ?? '一名秘书'
    useUI.getState().showToast(`${name}已上岗 · 月薪 ¥120 / 班`)
    onClose()
  }

  return (
    <section className="status-section conversation-extension">
      <h3>聘请秘书</h3>
      <p className="hr-intro">从城里挑一名空闲的市民坐镇。秘书的薪水从faction资金里发。</p>
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

function SecretaryVerbs({ secretary, onClose }: { secretary: Entity; onClose: () => void }) {
  const player = useQueryFirst(IsPlayer)!
  const secInfo = useTrait(secretary, Character)
  // Subscribe so the verb panel re-renders after each mutation.
  const allBuildings = useQuery(Building, Owner)
  const allStations = useQuery(Workstation)
  void allBuildings
  void allStations

  const status = factionStatus(world, player)
  const [reply, setReply] = useState<string | null>(null)

  const onRoster = () => {
    playUi('ui.factory-manager.accept')
    const summary = assignIdleMembers(world, player)
    if (summary.assigned === 0) {
      setReply(summary.unassigned > 0
        ? `没合适岗位 · 还有${summary.unassigned}人空着。`
        : '没人空着 · 大家都在岗。')
      return
    }
    const parts = summary.perFacility.map((p) => `${p.label}${p.count}人`).join('、')
    const tail = summary.unassigned > 0 ? ` 剩${summary.unassigned}人没合适岗位。` : ''
    setReply(`已分配${parts}。${tail}`)
  }

  const onBeds = () => {
    playUi('ui.factory-manager.accept')
    const summary = assignBeds(world, player)
    if (summary.assigned === 0) {
      setReply(summary.unhousedRemaining > 0
        ? `没有空床位 · 还有${summary.unhousedRemaining}人没安排住处。`
        : '床位都已分配妥当。')
      return
    }
    const tail = summary.unhousedRemaining > 0
      ? ` 床位不够 · 还有${summary.unhousedRemaining}人没住处。`
      : ''
    setReply(`已分配${summary.assigned}个床位。${tail}`)
  }

  const onBooks = () => {
    playUi('ui.npc.smalltalk')
    const b = bookSummary(world, player)
    const lines: string[] = []
    lines.push(`资金 ¥${b.fund.toLocaleString()} · 今日净 ${formatSigned(b.todayNet)}`)
    if (b.topRevenue.length > 0) {
      lines.push(`收入: ${b.topRevenue.map((r) => `${r.label} ¥${r.amount}`).join('、')}`)
    }
    if (b.topExpense.length > 0) {
      lines.push(`支出: ${b.topExpense.map((r) => `${r.label} ¥${r.amount}`).join('、')}`)
    }
    setReply(lines.join('\n'))
  }

  const onSideways = () => {
    playUi('ui.npc.smalltalk')
    const r = sidewaysReport(world, player)
    const lines: string[] = []
    if (r.insolventFacilities.length > 0) {
      const names = r.insolventFacilities.slice(0, 3).map((f) =>
        f.closed ? `${f.label}(关停)` : `${f.label}(欠薪${f.days}天)`,
      ).join('、')
      lines.push(`资金不够: ${names}`)
    }
    if (r.vacantStations.length > 0) {
      const names = r.vacantStations.slice(0, 3).map((s) => `${s.label}的${s.jobTitle}`).join('、')
      lines.push(`空岗: ${names}`)
    }
    if (r.unhousedCount > 0) {
      lines.push(`住处不够: ${r.unhousedNames.join('、')}${r.unhousedCount > 3 ? '等' : ''} (${r.unhousedCount}人)`)
    }
    setReply(lines.length === 0 ? '一切顺当 · 没什么坏事。' : lines.join('\n'))
  }

  const onRestructure = () => {
    playUi('ui.npc.smalltalk')
    setReply('正式成立faction的入口在 5.5.5 上线 · 现在你的钱包就是faction资金。')
  }

  return (
    <section className="status-section conversation-extension">
      <h3>{secInfo?.name ?? '秘书'} · {secInfo?.title ?? '秘书'}</h3>
      <div className="hr-intro">
        成员 {status.memberCount} · 设施 {status.facilityCount} · 床位 {status.bedCount} · 没住处 {status.unhousedCount}
      </div>
      {reply && <p className="dialog-response" style={{ whiteSpace: 'pre-line' }}>{reply}</p>}
      <div className="dialog-options secretary-verbs">
        <button className="dialog-option" onClick={onRoster}>把闲人安排到岗</button>
        <button className="dialog-option" onClick={onBeds}>给成员分配床位</button>
        <button className="dialog-option" onClick={onBooks}>读一下账本</button>
        <button className="dialog-option" onClick={onSideways}>有没有出岔子？</button>
        <button className="dialog-option" onClick={onRestructure}>正式成立faction</button>
        <button className="dialog-option" onClick={onClose}>再见</button>
      </div>
    </section>
  )
}

function formatSigned(n: number): string {
  if (n === 0) return '¥0'
  return n > 0 ? `+¥${n}` : `-¥${Math.abs(n)}`
}
