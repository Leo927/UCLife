import { useState } from 'react'
import { useQuery, useQueryFirst, useTrait } from 'koota/react'
import type { Entity } from 'koota'
import {
  Building, Character, IsPlayer, Owner, Workstation,
} from '../../../ecs/traits'
import { world } from '../../../ecs/world'
import { playUi } from '../../../audio/player'
import {
  assignBeds, assignIdleMembers, bookSummary, factionStatus, sidewaysReport,
} from '../../../systems/secretaryRoster'
import { dialogueText } from '../../../data/dialogueText'
import type { DialogueCtx, DialogueNode } from '../types'

export function secretaryBranch(ctx: DialogueCtx): DialogueNode | null {
  if (!ctx.roles.isSecretaryOnDuty) return null
  return {
    id: 'secretary',
    label: dialogueText.buttons.secretary,
    info: dialogueText.branches.secretary.title,
    specialUI: () => <SecretaryPanel secretary={ctx.npc} />,
  }
}

function SecretaryPanel({ secretary }: { secretary: Entity }) {
  const player = useQueryFirst(IsPlayer)!
  const secInfo = useTrait(secretary, Character)
  void useQuery(Building, Owner)
  void useQuery(Workstation)

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
    <>
      <h3>{secInfo?.name ?? '秘书'} · {dialogueText.branches.secretary.title}</h3>
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
      </div>
    </>
  )
}

function formatSigned(n: number): string {
  if (n === 0) return '¥0'
  return n > 0 ? `+¥${n}` : `-¥${Math.abs(n)}`
}
