import { useQueryFirst, useTrait } from 'koota/react'
import { IsPlayer, Vitals, Health, Inventory, Action } from '../ecs/traits'
import { useUI } from './uiStore'
import { READING_DURATION_MIN, EATING_DURATION_MIN, DRINKING_DURATION_MIN } from '../data/actions'

export function InventoryPanel() {
  const open = useUI((s) => s.inventoryOpen)
  const setOpen = useUI((s) => s.setInventory)
  const player = useQueryFirst(IsPlayer, Vitals, Health)
  const inventory = useTrait(player, Inventory)
  const action = useTrait(player, Action)

  if (!open) return null

  const isBusyAction = action && action.kind !== 'idle' && action.kind !== 'walking' && action.kind !== 'working'
  const canRead = action?.kind === 'idle' && (inventory?.books ?? 0) > 0

  const startReading = () => {
    if (!player || !canRead) return
    player.set(Action, { kind: 'reading', remaining: READING_DURATION_MIN, total: READING_DURATION_MIN })
    setOpen(false)
  }

  const drinkWater = () => {
    if (!player || !inventory || inventory.water === 0) return
    if (isBusyAction) return
    player.set(Action, { kind: 'drinking', remaining: DRINKING_DURATION_MIN, total: DRINKING_DURATION_MIN })
    setOpen(false)
  }

  const eatMeal = () => {
    if (!player || !inventory || inventory.meal === 0) return
    if (isBusyAction) return
    player.set(Action, { kind: 'eating', remaining: EATING_DURATION_MIN, total: EATING_DURATION_MIN })
    setOpen(false)
  }

  // Same `eating` action as basic meal — actionSystem consumes premium first
  // when available, so the path is unified for player + NPC.
  const eatPremiumMeal = () => {
    if (!player || !inventory || inventory.premiumMeal === 0) return
    if (isBusyAction) return
    player.set(Action, { kind: 'eating', remaining: EATING_DURATION_MIN, total: EATING_DURATION_MIN })
    setOpen(false)
  }

  const hasInv = inventory && (inventory.water > 0 || inventory.meal > 0 || inventory.premiumMeal > 0 || inventory.books > 0)

  return (
    <div className="status-overlay" onClick={() => setOpen(false)}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>物品</h2>
          <button className="status-close" onClick={() => setOpen(false)} aria-label="关闭">✕</button>
        </header>

        <section className="status-section">
          {!hasInv && <p className="status-muted">背包空空如也</p>}
          {inventory && inventory.water > 0 && (
            <div className="inv-row">
              <span className="inv-name">矿泉水 × {inventory.water}</span>
              <button className="inv-action" onClick={drinkWater} disabled={isBusyAction}>饮用 (1分钟)</button>
            </div>
          )}
          {inventory && inventory.meal > 0 && (
            <div className="inv-row">
              <span className="inv-name">简餐 × {inventory.meal}</span>
              <button className="inv-action" onClick={eatMeal} disabled={isBusyAction}>食用 (10分钟)</button>
            </div>
          )}
          {inventory && inventory.premiumMeal > 0 && (
            <div className="inv-row">
              <span className="inv-name">套餐 × {inventory.premiumMeal}</span>
              <button className="inv-action" onClick={eatPremiumMeal} disabled={isBusyAction}>食用 (10分钟)</button>
            </div>
          )}
          {inventory && inventory.books > 0 && (
            <div className="inv-row">
              <span className="inv-name">机械原理 × {inventory.books}</span>
              <button className="inv-action" onClick={startReading} disabled={!canRead}>
                阅读 (2小时)
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
