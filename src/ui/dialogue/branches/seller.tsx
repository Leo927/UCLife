import { useMemo } from 'react'
import { useQuery, useQueryFirst, useTrait } from 'koota/react'
import type { Entity } from 'koota'
import { IsPlayer, Money, Owner, Building, EntityKey } from '../../../ecs/traits'
import { useUI } from '../../uiStore'
import {
  privateAskingPrice, buyFromOwner, gatherListings, type RealtyListing,
} from '../../../systems/realtor'
import { world } from '../../../ecs/world'
import { playUi } from '../../../audio/player'
import { dialogueText } from '../../../data/dialogueText'
import type { DialogueCtx, DialogueNode } from '../types'

export function sellerBranch(ctx: DialogueCtx): DialogueNode | null {
  if (!ctx.roles.ownsPrivateFacility) return null
  return {
    id: 'seller',
    label: dialogueText.buttons.seller,
    info: dialogueText.branches.seller.intro,
    specialUI: () => <SellerPanel seller={ctx.npc} />,
  }
}

function SellerPanel({ seller }: { seller: Entity }) {
  const player = useQueryFirst(IsPlayer, Money)
  const money = useTrait(player, Money)
  const allBuildings = useQuery(Building, Owner, EntityKey)

  const listings = useMemo(() => {
    return gatherListings(world).filter(
      (l) => l.ownerKind === 'character' && l.seller?.entity === seller,
    )
  }, [allBuildings, seller])

  if (listings.length === 0 || !player) return null

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
    <>
      <h3>{dialogueText.branches.seller.title}</h3>
      <div className="shop-money">
        钱包: <span className="shop-money-amount">¥{money?.amount.toLocaleString() ?? 0}</span>
      </div>
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
    </>
  )
}
