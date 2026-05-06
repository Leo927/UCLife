import { useQueryFirst, useTrait } from 'koota/react'
import { IsPlayer, Vitals, Health, Inventory } from '../ecs/traits'
import { useUI } from './uiStore'

export function StatusBarFooter() {
  const toggleStatus = useUI((s) => s.toggleStatus)
  const toggleInventory = useUI((s) => s.toggleInventory)
  const player = useQueryFirst(IsPlayer, Vitals, Health)
  const inventory = useTrait(player, Inventory)
  const invCount = inventory
    ? inventory.water + inventory.meal + inventory.premiumMeal + inventory.books
    : 0

  return (
    <div className="status-footer">
      <button className="status-footer-btn" onClick={toggleStatus}>
        <span className="status-footer-label">状态</span>
        <span className="status-footer-cta">›</span>
      </button>
      <button className="status-footer-btn" onClick={toggleInventory}>
        <span className="status-footer-label">物品</span>
        {invCount > 0 && <span className="status-footer-count">{invCount}</span>}
        <span className="status-footer-cta">›</span>
      </button>
    </div>
  )
}
