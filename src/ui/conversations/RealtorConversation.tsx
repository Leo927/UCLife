import { useMemo, useState } from 'react'
import { useQuery, useQueryFirst, useTrait } from 'koota/react'
import type { Entity } from 'koota'
import {
  IsPlayer, Money, Bed, Position, MoveTarget, QueuedInteract, Home, Attributes, Owner, Building,
} from '../../ecs/traits'
import type { BedTier } from '../../ecs/traits'
import { useUI } from '../uiStore'
import { useClock } from '../../sim/clock'
import { claimHome, buyHome } from '../../systems/market'
import { world } from '../../ecs/world'
import { bedActiveOccupant } from '../../systems/bed'
import {
  gatherListings, buyFromState, type RealtyListing,
} from '../../systems/realtor'
import { economyConfig } from '../../config'
import { getStat } from '../../stats/sheet'
import { playUi } from '../../audio/player'

type Tab = 'residential' | 'commercial' | 'factionMisc'

const TAB_LABEL: Record<Tab, string> = {
  residential: '住宅',
  commercial: '商铺',
  factionMisc: '机构',
}

const BED_TIER_ORDER: BedTier[] = ['luxury', 'apartment', 'dorm', 'flop']

const BED_TIER_LABEL: Record<BedTier, string> = {
  luxury: '高级公寓',
  apartment: '公寓',
  dorm: '工人宿舍',
  flop: '廉价旅馆',
  lounge: '员工沙发',
}

const BED_TIER_UNIT_LABEL: Record<BedTier, string> = {
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

function applyRentMul(listed: number, mul: number): number {
  return Math.max(1, Math.round(listed * mul))
}

export function RealtorConversation() {
  const player = useQueryFirst(IsPlayer, Money)
  const money = useTrait(player, Money)
  const playerHome = useTrait(player, Home)
  const attrs = useTrait(player, Attributes)
  const rentMul = attrs ? getStat(attrs.sheet, 'rentMul') : 1
  // Subscribe to broad changes so listings refresh after a purchase.
  const allBeds = useQuery(Bed, Position)
  const allBuildings = useQuery(Building, Owner)
  const gameMs = useClock((s) => s.gameDate.getTime())
  const [tab, setTab] = useState<Tab>('residential')

  const listings = useMemo(() => {
    return gatherListings(world)
    // allBuildings is captured above so the memo invalidates on any
    // Owner/Building change; the dep array enforces re-collection.
  }, [allBuildings])

  const listingsByCategory = useMemo(() => {
    const r: RealtyListing[] = []
    const c: RealtyListing[] = []
    const f: RealtyListing[] = []
    for (const l of listings) {
      if (l.category === 'residential') r.push(l)
      else if (l.category === 'commercial') c.push(l)
      else if (l.category === 'factionMisc') f.push(l)
    }
    return { residential: r, commercial: c, factionMisc: f }
  }, [listings])

  const apartmentBedRows = useMemo(() => {
    const byTier: Record<BedTier, { ent: Entity; pos: { x: number; y: number } }[]> = {
      luxury: [], apartment: [], dorm: [], flop: [], lounge: [],
    }
    for (const ent of allBeds) {
      const b = ent.get(Bed)
      if (!b) continue
      const pos = ent.get(Position)
      if (!pos) continue
      byTier[b.tier as BedTier].push({ ent, pos: { x: pos.x, y: pos.y } })
    }
    for (const tier of BED_TIER_ORDER) {
      byTier[tier].sort((a, b) => (a.pos.y - b.pos.y) || (a.pos.x - b.pos.x))
    }
    return byTier
  }, [allBeds])

  const close = () => useUI.getState().setDialogNPC(null)

  const walkToBuilding = (listing: RealtyListing) => {
    if (!player) return
    playUi('ui.realtor.preview')
    const cx = listing.rect.x + listing.rect.w / 2
    const cy = listing.rect.y + listing.rect.h / 2
    player.set(MoveTarget, { x: cx, y: cy })
    if (player.has(QueuedInteract)) player.remove(QueuedInteract)
    close()
  }

  const walkToSeller = (listing: RealtyListing) => {
    if (!player || !listing.seller) return
    const sellerPos = listing.seller.entity.get(Position)
    if (!sellerPos) return
    playUi('ui.realtor.preview')
    player.set(MoveTarget, { x: sellerPos.x, y: sellerPos.y })
    if (player.has(QueuedInteract)) player.remove(QueuedInteract)
    useUI.getState().showToast(`走向 ${listing.seller.name} · 找业主谈交易`)
    close()
  }

  const buyState = (listing: RealtyListing) => {
    if (!player) return
    if (listing.askingPrice === null) return
    if (!money || money.amount < listing.askingPrice) {
      useUI.getState().showToast(`金钱不足 · 需 ¥${listing.askingPrice.toLocaleString()}`)
      return
    }
    playUi('ui.realtor.buy')
    const paid = buyFromState(player, listing)
    if (paid !== null) {
      useUI.getState().showToast(`房产过户成功 · ${listing.labelZh} · ¥${paid.toLocaleString()}`)
    } else {
      useUI.getState().showToast('购房失败')
    }
  }

  const previewBed = (bedEnt: Entity) => {
    if (!player) return
    const pos = bedEnt.get(Position)
    if (!pos) return
    playUi('ui.realtor.preview')
    player.set(MoveTarget, { x: pos.x, y: pos.y })
    if (player.has(QueuedInteract)) player.remove(QueuedInteract)
    close()
  }

  const rentBed = (bedEnt: Entity) => {
    if (!player || !money) return
    const b = bedEnt.get(Bed)
    if (!b) return
    const tier = b.tier as BedTier
    const adjustedRent = applyRentMul(b.nightlyRent, rentMul)
    const deposit = depositFor(tier, adjustedRent)
    const total = adjustedRent + deposit
    if (money.amount < total) {
      useUI.getState().showToast(`金钱不足 · 需 ¥${total}`)
      return
    }
    const active = bedActiveOccupant(b, gameMs)
    if (active !== null && active !== player) {
      useUI.getState().showToast('该房源已被人租下')
      return
    }
    playUi('ui.realtor.rent')
    if (deposit > 0) {
      player.set(Money, { amount: money.amount - deposit })
    }
    if (claimHome(world, player, bedEnt)) {
      useUI.getState().showToast(`已签订租约 · 共支付 ¥${total}`)
      close()
    } else {
      if (deposit > 0) {
        const m = player.get(Money)
        if (m) player.set(Money, { amount: m.amount + deposit })
      }
      useUI.getState().showToast('签约失败')
    }
  }

  const buyBed = (bedEnt: Entity) => {
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
    playUi('ui.realtor.buy')
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
      <p className="hr-intro">{tabHelp(tab)}</p>
      <div className="shop-money">钱包: <span className="shop-money-amount">¥{money?.amount.toLocaleString() ?? 0}</span></div>

      <div className="realtor-tabs">
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <button
            key={t}
            className={`realtor-tab ${tab === t ? 'active' : ''}`}
            onClick={() => { playUi('ui.realtor.preview'); setTab(t) }}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === 'residential' && (
        <ResidentialPanel
          listings={listingsByCategory.residential}
          bedRows={apartmentBedRows}
          gameMs={gameMs}
          playerEnt={player ?? null}
          playerHomeEnt={playerHome?.bed ?? null}
          playerMoney={money?.amount ?? 0}
          rentMul={rentMul}
          onPreview={previewBed}
          onRent={rentBed}
          onBuyBed={buyBed}
          onWalkToBuilding={walkToBuilding}
          onWalkToSeller={walkToSeller}
          onBuyState={buyState}
        />
      )}
      {tab === 'commercial' && (
        <BuildingListPanel
          listings={listingsByCategory.commercial}
          playerMoney={money?.amount ?? 0}
          onWalkToBuilding={walkToBuilding}
          onWalkToSeller={walkToSeller}
          onBuyState={buyState}
        />
      )}
      {tab === 'factionMisc' && (
        <BuildingListPanel
          listings={listingsByCategory.factionMisc}
          playerMoney={money?.amount ?? 0}
          onWalkToBuilding={walkToBuilding}
          onWalkToSeller={walkToSeller}
          onBuyState={buyState}
        />
      )}
    </section>
  )
}

function tabHelp(tab: Tab): string {
  switch (tab) {
    case 'residential': return '租公寓按月签约 · 公寓和高级公寓可购入。整栋宿舍/旅馆可在此挂牌交易。'
    case 'commercial':  return '酒吧、便利店、工厂。国有产权由我直接转让 · 私人产权需当面与业主谈。'
    case 'factionMisc': return '城市机构（人事局等）。国有产权可直接收购。'
  }
}

function BuildingListPanel({
  listings,
  playerMoney,
  onWalkToBuilding,
  onWalkToSeller,
  onBuyState,
}: {
  listings: RealtyListing[]
  playerMoney: number
  onWalkToBuilding: (l: RealtyListing) => void
  onWalkToSeller: (l: RealtyListing) => void
  onBuyState: (l: RealtyListing) => void
}) {
  if (listings.length === 0) {
    return <p className="hr-intro">暂无可挂牌的房源。</p>
  }
  return (
    <>
      {listings.map((l) => (
        <BuildingRow
          key={l.buildingKey}
          listing={l}
          playerMoney={playerMoney}
          onWalkToBuilding={onWalkToBuilding}
          onWalkToSeller={onWalkToSeller}
          onBuyState={onBuyState}
        />
      ))}
    </>
  )
}

function BuildingRow({
  listing,
  playerMoney,
  onWalkToBuilding,
  onWalkToSeller,
  onBuyState,
}: {
  listing: RealtyListing
  playerMoney: number
  onWalkToBuilding: (l: RealtyListing) => void
  onWalkToSeller: (l: RealtyListing) => void
  onBuyState: (l: RealtyListing) => void
}) {
  const sellerLabel = ownerLabel(listing)
  const priceLabel = listing.askingPrice !== null ? `¥${listing.askingPrice.toLocaleString()}` : '当面议价'
  const buyDisabled = listing.askingPrice === null || playerMoney < listing.askingPrice

  return (
    <div className="apt-row">
      <div className="apt-row-info">
        <div className="apt-row-name">{listing.labelZh} · {sizeLabel(listing.rect)}</div>
        <div className="apt-row-meta">业主: {sellerLabel} · 标价 {priceLabel}</div>
      </div>
      <div className="apt-row-actions">
        <button className="apt-row-preview" onClick={() => onWalkToBuilding(listing)}>看位置</button>
        {listing.ownerKind === 'state' && listing.askingPrice !== null && (
          <button
            className="apt-row-buy"
            disabled={buyDisabled}
            onClick={() => onBuyState(listing)}
          >
            收购 ¥{listing.askingPrice.toLocaleString()}
          </button>
        )}
        {listing.ownerKind === 'character' && listing.seller && (
          <button className="apt-row-buy" onClick={() => onWalkToSeller(listing)}>
            找业主
          </button>
        )}
      </div>
    </div>
  )
}

function ownerLabel(listing: RealtyListing): string {
  if (listing.ownerKind === 'state') return '国有 · 现挂牌'
  if (listing.ownerKind === 'character' && listing.seller) return listing.seller.name
  return '未知'
}

function sizeLabel(rect: { w: number; h: number }): string {
  const w = Math.round(rect.w / 32)
  const h = Math.round(rect.h / 32)
  return `${w}×${h}`
}

// Residential tab keeps the existing bed-row UI for apartment/luxury/dorm/flop
// (per-bed rent + buy stays the canonical surface), and adds a building-row
// list for any residential building that's directly buyable as a whole.
function ResidentialPanel({
  listings,
  bedRows,
  gameMs,
  playerEnt,
  playerHomeEnt,
  playerMoney,
  rentMul,
  onPreview,
  onRent,
  onBuyBed,
  onWalkToBuilding,
  onWalkToSeller,
  onBuyState,
}: {
  listings: RealtyListing[]
  bedRows: Record<BedTier, { ent: Entity; pos: { x: number; y: number } }[]>
  gameMs: number
  playerEnt: Entity | null
  playerHomeEnt: Entity | null
  playerMoney: number
  rentMul: number
  onPreview: (e: Entity) => void
  onRent: (e: Entity) => void
  onBuyBed: (e: Entity) => void
  onWalkToBuilding: (l: RealtyListing) => void
  onWalkToSeller: (l: RealtyListing) => void
  onBuyState: (l: RealtyListing) => void
}) {
  // Pull out dorms (whole-building purchase) so the bed-row list stays
  // about apartment/luxury/flop. The building list is a separate sub-block.
  const dormBuildings = listings.filter((l) => l.typeId === 'dorm' || l.typeId === 'flop')

  return (
    <>
      {BED_TIER_ORDER.map((tier) => {
        const list = bedRows[tier]
        if (list.length === 0) return null
        return (
          <div key={tier} className="realtor-tier-group">
            <h4>{BED_TIER_LABEL[tier]}</h4>
            {list.map(({ ent }, idx) => (
              <RealtorBedRow
                key={ent.id()}
                bedEnt={ent}
                tier={tier}
                unitNumber={idx + 1}
                gameMs={gameMs}
                playerEnt={playerEnt}
                playerHomeEnt={playerHomeEnt}
                playerMoney={playerMoney}
                rentMul={rentMul}
                onPreview={onPreview}
                onRent={onRent}
                onBuy={onBuyBed}
              />
            ))}
          </div>
        )
      })}
      {dormBuildings.length > 0 && (
        <div className="realtor-tier-group">
          <h4>整栋出售（宿舍 / 旅馆）</h4>
          {dormBuildings.map((l) => (
            <BuildingRow
              key={l.buildingKey}
              listing={l}
              playerMoney={playerMoney}
              onWalkToBuilding={onWalkToBuilding}
              onWalkToSeller={onWalkToSeller}
              onBuyState={onBuyState}
            />
          ))}
        </div>
      )}
    </>
  )
}

function RealtorBedRow({
  bedEnt,
  tier,
  unitNumber,
  gameMs,
  playerEnt,
  playerHomeEnt,
  playerMoney,
  rentMul,
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
  rentMul: number
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
  const adjustedRent = applyRentMul(bed.nightlyRent, rentMul)
  const deposit = depositFor(tier, adjustedRent)
  const rentTotal = adjustedRent + deposit
  const purchase = purchasePriceFor(tier, bed.nightlyRent)
  const isCurrentHome = playerHomeEnt === bedEnt

  let rentLabel = `租 ¥${rentTotal}`
  let rentDisabled = false
  if (isPlayerOwned) { rentLabel = '已购入'; rentDisabled = true }
  else if (isPlayerClaim) { rentLabel = '你的租约'; rentDisabled = true }
  else if (isOtherClaim) { rentLabel = '已被租'; rentDisabled = true }
  else if (playerMoney < rentTotal) rentDisabled = true

  let buyLabel: string | null = null
  let buyDisabled = false
  if (purchase !== null) {
    buyLabel = `买 ¥${purchase.toLocaleString()}`
    if (isPlayerOwned) { buyLabel = '你的物业'; buyDisabled = true }
    else if (isOtherClaim) { buyLabel = '已被租'; buyDisabled = true }
    else if (playerMoney < purchase) buyDisabled = true
  }

  let statusTag: { text: string; cls: string } | null = null
  if (isPlayerOwned) statusTag = { text: '你的物业', cls: 'req-met' }
  else if (isPlayerClaim) statusTag = { text: '你的租约', cls: 'req-met' }
  else if (isOtherClaim) statusTag = { text: '已被租', cls: 'req-missed' }
  else if (isCurrentHome) statusTag = { text: '租期已过', cls: 'req-missed' }

  return (
    <div className="apt-row">
      <div className="apt-row-info">
        <div className="apt-row-name">{BED_TIER_UNIT_LABEL[tier]} {unitNumber}号</div>
        <div className="apt-row-meta">
          {tier === 'apartment' ? (
            <>月租 ¥{adjustedRent} · 押金 ¥{deposit} · 合计 ¥{rentTotal}</>
          ) : (
            <>租金 ¥{adjustedRent} / {rentPeriodLabel(tier)}</>
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
