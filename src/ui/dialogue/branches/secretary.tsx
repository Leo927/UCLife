import { useState } from 'react'
import { useQuery, useQueryFirst, useTrait } from 'koota/react'
import type { Entity } from 'koota'
import {
  Building, Character, Faction, Hangar, IsPlayer, IsPlayerFaction, Money, Owner,
  Workstation, EntityKey,
} from '../../../ecs/traits'
import type { SupplyKind } from '../../../ecs/traits'
import { world, getWorld, SCENE_IDS } from '../../../ecs/world'
import { playUi } from '../../../audio/player'
import {
  assignBeds, assignIdleMembers, bookSummary, factionStatus, sidewaysReport,
} from '../../../systems/secretaryRoster'
import {
  createPlayerFaction, withdrawFromPlayerFaction,
} from '../../../ecs/playerFactionCreate'
import { factionsConfig } from '../../../config'
import { dialogueText } from '../../../data/dialogueText'
import { fleetConfig, economicsConfig } from '../../../config'
import { enqueueSupplyDelivery } from '../../../systems/fleetSupplyDelivery'
import { emitSim } from '../../../sim/events'
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
  // Re-render when the player-faction entity appears so the restructure
  // verb flips into the post-creation diplomacy panel without closing the
  // dialog.
  const factionEntity = useQueryFirst(IsPlayerFaction) ?? null
  void useTrait(factionEntity ?? secretary, Faction)

  const status = factionStatus(world, player)
  const [reply, setReply] = useState<string | null>(null)
  const [pendingCreate, setPendingCreate] = useState(false)

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

  const wallet = player.get(Money)?.amount ?? 0
  const minWallet = economicsConfig.playerFaction.minWalletToCreate
  const creationStipend = economicsConfig.playerFaction.creationStipend
  const factionMeta = factionsConfig.catalog.player
  const created = factionEntity !== null
  const fund = factionEntity?.get(Faction)?.fund ?? 0

  const onRestructure = () => {
    playUi('ui.npc.smalltalk')
    if (created) return
    if (wallet < minWallet) {
      setReply(
        `资金太少 · 至少要 ¥${minWallet.toLocaleString()} 才能注册 ${factionMeta.shortZh}。`,
      )
      return
    }
    setPendingCreate(true)
    const seedNet = Math.max(0, wallet - creationStipend)
    setReply(
      `成立 ${factionMeta.nameZh}？\n· 你的钱包 ¥${wallet.toLocaleString()} 将注入 faction，\n  保留 ¥${Math.min(wallet, creationStipend).toLocaleString()} 作个人津贴，\n  faction 启动资金 ¥${seedNet.toLocaleString()}。\n· 名下设施所有权全部归入新 faction。`,
    )
  }

  const onConfirmCreate = () => {
    playUi('ui.factory-manager.accept')
    const r = createPlayerFaction(world, player)
    setPendingCreate(false)
    if (!r.created) {
      setReply(`${factionMeta.shortZh}已经成立 · 不需要重复登记。`)
      return
    }
    const text = `${factionMeta.nameZh}成立 · 接管${r.migratedBuildings}处设施，启动金 ¥${r.walletMigrated.toLocaleString()}。`
    setReply(text)
    emitSim('toast', { textZh: text, durationMs: 8000 })
    emitSim('log', { textZh: text, atMs: Date.now() })
  }

  const onCancelCreate = () => {
    playUi('ui.npc.smalltalk')
    setPendingCreate(false)
    setReply('好 · 等你想清楚再说。')
  }

  const onWithdrawStipend = () => {
    playUi('ui.factory-manager.accept')
    if (!factionEntity) return
    const amount = Math.min(fund, creationStipend)
    if (amount <= 0) { setReply('faction 资金为零 · 无法拨款。'); return }
    const moved = withdrawFromPlayerFaction(world, player, amount)
    setReply(`已从 faction 资金中拨 ¥${moved.toLocaleString()} 到你的个人账户。`)
  }

  const onDeclareWar = () => {
    playUi('ui.npc.smalltalk')
    setReply('宣战 / 外交 verb 是 6.4 议政厅场景的占位 · 现在还没有外部势力可以谈判。')
  }

  // Phase 6.2.F bulk-order: same shape as the AE supply dealer's order,
  // but at a markup (faction logistics) and faster delivery. Targets
  // the first available hangar — the secretary picks a destination on
  // the player's behalf (this is the auto-batched scale valve).
  const t = dialogueText.branches.secretaryBulkOrder
  const placeBulk = (kind: SupplyKind) => {
    playUi('ui.factory-manager.accept')
    if (!player) return
    const hangar = firstAvailableHangar()
    if (!hangar) { setReply(t.bulkNoHangar); return }
    const have = player.get(Money)?.amount ?? 0
    const qty = fleetConfig.supplyOrderQuantum
    const unit = kind === 'supply' ? fleetConfig.supplyPricePerUnit : fleetConfig.fuelPricePerUnit
    const cost = Math.round(unit * fleetConfig.secretaryBulkOrderMarkup * qty)
    const days = fleetConfig.secretaryBulkOrderDeliveryDays
    if (have < cost) {
      setReply(t.bulkInsufficient.replace('{need}', String(cost)).replace('{have}', String(have)))
      return
    }
    player.set(Money, { amount: have - cost })
    enqueueSupplyDelivery(hangar, kind, qty, days)
    setReply(
      t.bulkOrderPlaced
        .replace('{qty}', String(qty))
        .replace('{kind}', kind === 'supply' ? t.kindSupply : t.kindFuel)
        .replace('{cost}', String(cost))
        .replace('{days}', String(days)),
    )
  }

  const markupPct = Math.round((fleetConfig.secretaryBulkOrderMarkup - 1) * 100)

  return (
    <>
      <h3>{secInfo?.name ?? '秘书'} · {dialogueText.branches.secretary.title}</h3>
      <div className="hr-intro">
        {created
          ? <>
              {factionMeta.nameZh} · 资金 ¥{fund.toLocaleString()} · 成员 {status.memberCount} · 设施 {status.facilityCount} · 床位 {status.bedCount} · 没住处 {status.unhousedCount}
            </>
          : <>成员 {status.memberCount} · 设施 {status.facilityCount} · 床位 {status.bedCount} · 没住处 {status.unhousedCount}</>
        }
      </div>
      {reply && <p className="dialog-response" style={{ whiteSpace: 'pre-line' }}>{reply}</p>}
      <div className="dialog-options secretary-verbs">
        <button className="dialog-option" onClick={onRoster}>把闲人安排到岗</button>
        <button className="dialog-option" onClick={onBeds}>给成员分配床位</button>
        <button className="dialog-option" onClick={onBooks}>读一下账本</button>
        <button className="dialog-option" onClick={onSideways}>有没有出岔子？</button>
        {!created && !pendingCreate && (
          <button
            className="dialog-option"
            data-verb="create-faction"
            onClick={onRestructure}
          >正式成立faction</button>
        )}
        {!created && pendingCreate && (
          <>
            <button
              className="dialog-option"
              data-verb="create-faction-confirm"
              onClick={onConfirmCreate}
            >确认成立 {factionMeta.shortZh}</button>
            <button className="dialog-option" onClick={onCancelCreate}>再想想</button>
          </>
        )}
        {created && (
          <>
            <button
              className="dialog-option"
              data-verb="withdraw-stipend"
              onClick={onWithdrawStipend}
            >从 faction 拨款到个人账户</button>
            <button
              className="dialog-option"
              data-verb="declare-war"
              onClick={onDeclareWar}
            >宣战 / 外交（占位）</button>
          </>
        )}
      </div>
      <h3 style={{ marginTop: 12 }}>{t.header}</h3>
      <div className="hr-intro">
        {t.bulkUnit.replace('{qty}', String(fleetConfig.supplyOrderQuantum))}
        {' · '}{t.bulkMarkup.replace('{pct}', String(markupPct))}
        {' · '}{t.bulkEta.replace('{days}', String(fleetConfig.secretaryBulkOrderDeliveryDays))}
      </div>
      <div className="dialog-options">
        <button
          className="dialog-option"
          data-bulk-order="supply"
          onClick={() => placeBulk('supply')}
        >{t.bulkSupplyButton}</button>
        <button
          className="dialog-option"
          data-bulk-order="fuel"
          onClick={() => placeBulk('fuel')}
        >{t.bulkFuelButton}</button>
      </div>
    </>
  )
}

function firstAvailableHangar(): Entity | null {
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const ent of w.query(Building, Hangar, EntityKey)) {
      return ent
    }
  }
  return null
}

function formatSigned(n: number): string {
  if (n === 0) return '¥0'
  return n > 0 ? `+¥${n}` : `-¥${Math.abs(n)}`
}
