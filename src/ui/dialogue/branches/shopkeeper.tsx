import { useQueryFirst, useTrait } from 'koota/react'
import { IsPlayer, Money, Inventory, Attributes } from '../../../ecs/traits'
import { SHOP_ITEMS, type ShopItem } from '../../../data/shop'
import { getStat } from '../../../stats/sheet'
import { playUi } from '../../../audio/player'
import { dialogueText } from '../../../data/dialogueText'
import type { DialogueCtx, DialogueNode } from '../types'

export function shopkeeperBranch(ctx: DialogueCtx): DialogueNode | null {
  if (!ctx.roles.isCashierOnDuty) return null
  return {
    id: 'shop',
    label: dialogueText.buttons.shop,
    info: dialogueText.branches.shop.intro,
    specialUI: () => <ShopList />,
  }
}

function ShopList() {
  const player = useQueryFirst(IsPlayer, Money)
  const money = useTrait(player, Money)
  const attrs = useTrait(player, Attributes)
  const shopMul = attrs ? getStat(attrs.sheet, 'shopMul') : 1

  if (!player) return null

  const priceOf = (item: ShopItem) => Math.max(1, Math.round(item.price * shopMul))

  const buy = (item: ShopItem) => {
    if (!money) return
    const price = priceOf(item)
    if (money.amount < price) return
    playUi('ui.shop.buy')
    player.set(Money, { amount: money.amount - price })
    const inv = player.get(Inventory)
    if (!inv) return
    switch (item.effect.type) {
      case 'add_water':
        player.set(Inventory, { ...inv, water: inv.water + 1 })
        break
      case 'add_meal':
        player.set(Inventory, { ...inv, meal: inv.meal + 1 })
        break
      case 'add_premium_meal':
        player.set(Inventory, { ...inv, premiumMeal: inv.premiumMeal + 1 })
        break
      case 'add_book':
        player.set(Inventory, { ...inv, books: inv.books + 1 })
        break
    }
  }

  return (
    <>
      <h3>{dialogueText.branches.shop.title}</h3>
      <div className="shop-money">
        金钱: <span className="shop-money-amount">¥{money?.amount ?? 0}</span>
      </div>
      {SHOP_ITEMS.map((item) => {
        const price = priceOf(item)
        const canAfford = (money?.amount ?? 0) >= price
        return (
          <div key={item.id} className="shop-item">
            <div className="shop-item-info">
              <div className="shop-item-name">{item.label}</div>
              <div className="shop-item-desc">{item.description}</div>
            </div>
            <button
              className="shop-item-buy"
              disabled={!canAfford}
              onClick={() => buy(item)}
            >
              ¥{price}
            </button>
          </div>
        )
      })}
    </>
  )
}
