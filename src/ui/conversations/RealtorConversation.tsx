import { useMemo } from 'react'
import { useQuery, useQueryFirst, useTrait } from 'koota/react'
import type { Entity } from 'koota'
import { IsPlayer, Money, Bed, Position, MoveTarget, QueuedInteract, Home } from '../../ecs/traits'
import type { BedTier } from '../../ecs/traits'
import { useUI } from '../uiStore'
import { useClock } from '../../sim/clock'
import { claimHome, buyHome } from '../../systems/market'
import { world } from '../../ecs/world'
import { bedActiveOccupant } from '../../systems/bed'
import { economyConfig } from '../../config'

// Lounge couches are auto-claimed inside the AE complex (employee perk),
// not rentable through the realtor — kept out of TIER_ORDER.
const TIER_ORDER: BedTier[] = ['luxury', 'apartment', 'dorm', 'flop']

const TIER_LABEL: Record<BedTier, string> = {
  luxury: '高级公寓',
  apartment: '公寓',
  dorm: '工人宿舍',
  flop: '廉价旅馆',
  lounge: '员工沙发',
}

const TIER_UNIT_LABEL: Record<BedTier, string> = {
  luxury: '高级公寓',
  apartment: '公寓',
  dorm: '宿舍床',
  flop: '投币床',
  lounge: '员工沙发',
}

function rentPeriodLabel(tier: BedTier): string {
  return tier === 'flop' ? '12小时' : '月'
}

function depositFor(tier: BedTier, monthlyRent: number): number {
  if (tier === 'apartment') return Math.round(monthlyRent * economyConfig.rent.apartmentDepositMult)
  return 0
}

function purchasePriceFor(tier: BedTier, monthlyRent: number): number | null {
  if (tier === 'apartment') return monthlyRent * economyConfig.purchase.apartmentMonthsRent
  if (tier === 'luxury') return monthlyRent * economyConfig.purchase.luxuryMonthsRent
  return null
}

export function RealtorConversation() {
  const player = useQueryFirst(IsPlayer, Money)
  const money = useTrait(player, Money)
  const playerHome = useTrait(player, Home)
  const allBeds = useQuery(Bed, Position)
  // Subscribe to gameDate so active/expired status refreshes while open.
  const gameMs = useClock((s) => s.gameDate.getTime())

  // Stable per-tier numbering: sort by (y, x) so the same bed keeps the
  // same #N label across renders.
  const groups = useMemo(() => {
    const byTier: Record<BedTier, { ent: Entity; pos: { x: number; y: number } }[]> = {
      luxury: [],
      apartment: [],
      dorm: [],
      flop: [],
      lounge: [],
    }
    for (const ent of allBeds) {
      const b = ent.get(Bed)
      if (!b) continue
      const pos = ent.get(Position)
      if (!pos) continue
      byTier[b.tier as BedTier].push({ ent, pos: { x: pos.x, y: pos.y } })
    }
    for (const tier of TIER_ORDER) {
      byTier[tier].sort((a, b) => (a.pos.y - b.pos.y) || (a.pos.x - b.pos.x))
    }
    return byTier
  }, [allBeds])

  const close = () => useUI.getState().setDialogNPC(null)

  const preview = (bedEnt: Entity) => {
    if (!player) return
    const pos = bedEnt.get(Position)
    if (!pos) return
    player.set(MoveTarget, { x: pos.x, y: pos.y })
    if (player.has(QueuedInteract)) player.remove(QueuedInteract)
    close()
  }

  const rent = (bedEnt: Entity) => {
    if (!player || !money) return
    const b = bedEnt.get(Bed)
    if (!b) return
    const tier = b.tier as BedTier
    const deposit = depositFor(tier, b.nightlyRent)
    const total = b.nightlyRent + deposit
    if (money.amount < total) {
      useUI.getState().showToast(`金钱不足 · 需 ¥${total}`)
      return
    }
    const active = bedActiveOccupant(b, gameMs)
    if (active !== null && active !== player) {
      useUI.getState().showToast('该房源已被人租下')
      return
    }
    // claimHome charges nightlyRent itself; deduct only the deposit here.
    if (deposit > 0) {
      player.set(Money, { amount: money.amount - deposit })
    }
    if (claimHome(world, player, bedEnt)) {
      useUI.getState().showToast(`已签订租约 · 共支付 ¥${total}`)
      close()
    } else {
      // Refund the deposit on race / unexpected fall-through.
      if (deposit > 0) {
        const m = player.get(Money)
        if (m) player.set(Money, { amount: m.amount + deposit })
      }
      useUI.getState().showToast('签约失败')
    }
  }

  const buy = (bedEnt: Entity) => {
    if (!player || !money) return
    const b = bedEnt.get(Bed)
    if (!b) return
    const tier = b.tier as BedTier
    const price = purchasePriceFor(tier, b.nightlyRent)
    if (price === null) return
    if (money.amount < price) {
      useUI.getState().showToast(`金钱不足 · 需 ¥${price.toLocaleString()}`)
      return
    }
    if (buyHome(world, player, bedEnt, price)) {
      useUI.getState().showToast(`房产过户成功 · 共支付 ¥${price.toLocaleString()}`)
      close()
    } else {
      useUI.getState().showToast('购房失败 · 房源可能已被占用')
    }
  }

  return (
    <section className="status-section conversation-extension">
      <h3>房产 · 选择房源</h3>
      <p className="hr-intro">月租按月计 · 公寓押金 {economyConfig.rent.apartmentDepositMult.toFixed(0)} 月 · 公寓/高级公寓可购</p>
      <div className="shop-money">钱包: <span className="shop-money-amount">¥{money?.amount.toLocaleString() ?? 0}</span></div>

      {TIER_ORDER.map((tier) => {
        const list = groups[tier]
        if (list.length === 0) return null
        return (
          <div key={tier} className="realtor-tier-group">
            <h4>{TIER_LABEL[tier]}</h4>
            {list.map(({ ent }, idx) => (
              <RealtorRow
                key={ent.id()}
                bedEnt={ent}
                tier={tier}
                unitNumber={idx + 1}
                gameMs={gameMs}
                playerEnt={player ?? null}
                playerHomeEnt={playerHome?.bed ?? null}
                playerMoney={money?.amount ?? 0}
                onPreview={preview}
                onRent={rent}
                onBuy={buy}
              />
            ))}
          </div>
        )
      })}
    </section>
  )
}

function RealtorRow({
  bedEnt,
  tier,
  unitNumber,
  gameMs,
  playerEnt,
  playerHomeEnt,
  playerMoney,
  onPreview,
  onRent,
  onBuy,
}: {
  bedEnt: Entity
  tier: BedTier
  unitNumber: number
  gameMs: number
  playerEnt: Entity | null
  playerHomeEnt: Entity | null
  playerMoney: number
  onPreview: (e: Entity) => void
  onRent: (e: Entity) => void
  onBuy: (e: Entity) => void
}) {
  const bed = useTrait(bedEnt, Bed)
  if (!bed) return null
  const active = bedActiveOccupant(bed, gameMs)
  const isPlayerClaim = active !== null && active === playerEnt
  const isOtherClaim = active !== null && active !== playerEnt
  const isPlayerOwned = bed.owned && isPlayerClaim
  const deposit = depositFor(tier, bed.nightlyRent)
  const rentTotal = bed.nightlyRent + deposit
  const purchase = purchasePriceFor(tier, bed.nightlyRent)
  const isCurrentHome = playerHomeEnt === bedEnt

  let rentLabel = `租 ¥${rentTotal}`
  let rentDisabled = false
  if (isPlayerOwned) {
    rentLabel = '已购入'
    rentDisabled = true
  } else if (isPlayerClaim) {
    rentLabel = '你的租约'
    rentDisabled = true
  } else if (isOtherClaim) {
    rentLabel = '已被租'
    rentDisabled = true
  } else if (playerMoney < rentTotal) {
    rentDisabled = true
  }

  let buyLabel: string | null = null
  let buyDisabled = false
  if (purchase !== null) {
    buyLabel = `买 ¥${purchase.toLocaleString()}`
    if (isPlayerOwned) {
      buyLabel = '你的物业'
      buyDisabled = true
    } else if (isOtherClaim) {
      buyLabel = '已被租'
      buyDisabled = true
    } else if (playerMoney < purchase) {
      buyDisabled = true
    }
  }

  let statusTag: { text: string; cls: string } | null = null
  if (isPlayerOwned) statusTag = { text: '你的物业', cls: 'req-met' }
  else if (isPlayerClaim) statusTag = { text: '你的租约', cls: 'req-met' }
  else if (isOtherClaim) statusTag = { text: '已被租', cls: 'req-missed' }
  else if (isCurrentHome) statusTag = { text: '租期已过', cls: 'req-missed' }

  return (
    <div className="apt-row">
      <div className="apt-row-info">
        <div className="apt-row-name">{TIER_UNIT_LABEL[tier]} {unitNumber}号</div>
        <div className="apt-row-meta">
          {tier === 'apartment' ? (
            <>月租 ¥{bed.nightlyRent} · 押金 ¥{deposit} · 合计 ¥{rentTotal}</>
          ) : (
            <>租金 ¥{bed.nightlyRent} / {rentPeriodLabel(tier)}</>
          )}
          {purchase !== null && <> · 售价 ¥{purchase.toLocaleString()}</>}
        </div>
        {statusTag && (
          <div className="apt-row-meta">
            <span className={statusTag.cls}>{statusTag.text}</span>
          </div>
        )}
      </div>
      <div className="apt-row-actions">
        <button className="apt-row-preview" onClick={() => onPreview(bedEnt)}>看位置</button>
        <button
          className="apt-row-rent"
          disabled={rentDisabled}
          onClick={() => onRent(bedEnt)}
        >
          {rentLabel}
        </button>
        {buyLabel !== null && (
          <button
            className="apt-row-buy"
            disabled={buyDisabled}
            onClick={() => onBuy(bedEnt)}
          >
            {buyLabel}
          </button>
        )}
      </div>
    </div>
  )
}
