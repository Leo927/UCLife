import { economyConfig } from '../config'

export type ShopEffect =
  | { type: 'add_water' }
  | { type: 'add_meal' }
  | { type: 'add_premium_meal' }
  | { type: 'add_book' }

export type ShopItem = {
  id: string
  label: string
  price: number
  description: string
  effect: ShopEffect
}

export const SHOP_ITEMS: ShopItem[] = [
  { id: 'water', label: '矿泉水', price: economyConfig.prices.water, description: '随身携带 · 解口渴', effect: { type: 'add_water' } },
  { id: 'meal', label: '简餐', price: economyConfig.prices.meal, description: '随身携带 · 解饥饿', effect: { type: 'add_meal' } },
  { id: 'premium_meal', label: '套餐', price: economyConfig.prices.premiumMeal, description: '高档便当 · 解饥饿 · 略提魅力', effect: { type: 'add_premium_meal' } },
  { id: 'mech_book', label: '机械原理', price: 40, description: '阅读后获得机械经验', effect: { type: 'add_book' } },
]
