// Talk-verb branch on a private facility owner. Listed by the realtor's
// flagger flow ("找业主"). The player walks to the seller; this branch
// appears on the seller's NPC dialog when they own ≥1 facility in the
// player's current scene. Per facilities-and-ownership.md, the realtor
// names the seller and points at their world position; the deal closes
// here, in person.
//
// Phase 5.5.1 keeps the negotiation simple: a fixed-but-opinion-modulated
// asking price. Subsequent phases can add haggling, refusal, multi-turn
// dialog. The price formula lives in src/systems/realtor.ts so future
// negotiation flows reuse the same band logic.

import { useMemo } from 'react'
import { useQuery, useQueryFirst, useTrait } from 'koota/react'
import type { Entity } from 'koota'
import {
  IsPlayer, Money, Owner, Building, EntityKey,
} from '../../ecs/traits'
import { useUI } from '../uiStore'
import {
  privateAskingPrice, buyFromOwner, gatherListings, type RealtyListing,
} from '../../systems/realtor'
import { world } from '../../ecs/world'
import { playUi } from '../../audio/player'

export function SellerConversation({ seller }: { seller: Entity }) {
  const player = useQueryFirst(IsPlayer, Money)
  const money = useTrait(player, Money)
  // Re-collect listings on Owner change — purchases mutate the building's
  // Owner ref and the listing should disappear after a successful close.
  const allBuildings = useQuery(Building, Owner, EntityKey)

  const listings = useMemo(() => {
    return gatherListings(world).filter(
      (l) => l.ownerKind === 'character' && l.seller?.entity === seller,
    )
    // allBuildings is captured so the memo invalidates on Owner mutation.
  }, [allBuildings, seller])

  if (listings.length === 0) return null
  if (!player) return null

  const close = () => useUI.getState().setDialogNPC(null)

  const buy = (listing: RealtyListing, price: number) => {
    if (!money || money.amount < price) {
      useUI.getState().showToast(`金钱不足 · 需 ¥${price.toLocaleString()}`)
      return
    }
    playUi('ui.realtor.buy')
    if (buyFromOwner(player, listing, price)) {
      useUI.getState().showToast(`房产过户成功 · ${listing.labelZh} · ¥${price.toLocaleString()}`)
      close()
    } else {
      useUI.getState().showToast('交易失败')
    }
  }

  return (
    <section className="status-section conversation-extension">
      <h3>出售房产</h3>
      <p className="hr-intro">业主名下房产 · 标价随私交印象浮动</p>
      <div className="shop-money">钱包: <span className="shop-money-amount">¥{money?.amount.toLocaleString() ?? 0}</span></div>
      {listings.map((l) => {
        const price = privateAskingPrice(player, seller, l.typeId, l.rect)
        const priceLabel = price !== null ? `¥${price.toLocaleString()}` : '—'
        const disabled = price === null || (money?.amount ?? 0) < price
        const sizeStr = `${Math.round(l.rect.w / 32)}×${Math.round(l.rect.h / 32)}`
        return (
          <div key={l.buildingKey} className="apt-row">
            <div className="apt-row-info">
              <div className="apt-row-name">{l.labelZh} · {sizeStr}</div>
              <div className="apt-row-meta">业主开价 {priceLabel}</div>
            </div>
            <div className="apt-row-actions">
              <button
                className="apt-row-buy"
                disabled={disabled}
                onClick={() => price !== null && buy(l, price)}
              >
                收购
              </button>
            </div>
          </div>
        )
      })}
    </section>
  )
}
