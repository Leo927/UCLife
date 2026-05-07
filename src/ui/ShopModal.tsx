import { useQueryFirst, useTrait } from 'koota/react'
import { IsPlayer, Money, Inventory, Attributes } from '../ecs/traits'
import { useUI } from './uiStore'
import { SHOP_ITEMS, type ShopItem } from '../data/shop'
import { getStat } from '../stats/sheet'
import { playUi } from '../audio/player'

export function ShopModal() {
  const open = useUI((s) => s.shopOpen)
  const setShop = useUI((s) => s.setShop)
  const player = useQueryFirst(IsPlayer, Money)
  const money = useTrait(player, Money)
  const attrs = useTrait(player, Attributes)
  const shopMul = attrs ? getStat(attrs.sheet, 'shopMul') : 1

  if (!open) return null

  const priceOf = (item: ShopItem) => Math.max(1, Math.round(item.price * shopMul))

  const close = () => { playUi('ui.shop.close'); setShop(false) }

  const buy = (item: ShopItem) => {
    if (!player || !money) return
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
    <div className="status-overlay" onClick={close}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>便利店</h2>
          <button className="status-close" onClick={close} aria-label="关闭">✕</button>
        </header>

        <section className="status-section">
          <div className="shop-money">金钱: <span className="shop-money-amount">¥{money?.amount ?? 0}</span></div>
        </section>

        <section className="status-section">
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
        </section>
      </div>
    </div>
  )
}
