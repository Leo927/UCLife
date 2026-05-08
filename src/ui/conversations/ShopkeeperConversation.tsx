// Shopkeeper's inline dialog (rendered in NPCDialog when the player chats
// up an on-duty shop_*_clerk). The cell behind the cashier carries no
// Interactable trait — it is scenery only — per the worker-not-workstation
// rule in Design/social/diegetic-management.md. Buying always routes
// through the body behind the till.

import { useQueryFirst, useTrait } from 'koota/react'
import { IsPlayer, Money, Inventory, Attributes } from '../../ecs/traits'
import { useUI } from '../uiStore'
import { SHOP_ITEMS, type ShopItem } from '../../data/shop'
import { getStat } from '../../stats/sheet'
import { playUi } from '../../audio/player'

export function ShopkeeperConversation() {
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

  const close = () => useUI.getState().setDialogNPC(null)

  return (
    <section className="status-section conversation-extension" data-testid="shop-modal">
      <h3>便利店</h3>
      <div className="shop-money">金钱: <span className="shop-money-amount">¥{money?.amount ?? 0}</span></div>

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

      <div className="dialog-options" style={{ marginTop: 8 }}>
        <button className="dialog-option" onClick={close}>再见</button>
      </div>
    </section>
  )
}
