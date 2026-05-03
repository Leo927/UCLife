import { useQueryFirst, useTrait } from 'koota/react'
import { IsPlayer, Money, Skills, Flags } from '../../ecs/traits'
import { useUI } from '../uiStore'
import { getShipClass } from '../../data/ships'
import { getWeapon, isWeaponId } from '../../data/weapons'

const SHIP_ID = 'lightFreighter'
const PILOTING_REQUIRED = 10

export function ShipDealer() {
  const open = useUI((s) => s.shipDealerOpen)
  const close = () => useUI.getState().setShipDealer(false)
  const player = useQueryFirst(IsPlayer)
  const money = useTrait(player, Money)
  const skills = useTrait(player, Skills)
  const flags = useTrait(player, Flags)

  if (!open) return null

  const cls = getShipClass(SHIP_ID)
  const playerMoney = money?.amount ?? 0
  const piloting = skills?.piloting ?? 0
  const alreadyOwned = !!flags?.flags.shipOwned
  const canAfford = playerMoney >= cls.priceFiat
  const meetsPiloting = piloting >= PILOTING_REQUIRED

  const buy = () => {
    if (!player) return
    if (alreadyOwned) {
      useUI.getState().showToast('你已拥有飞船 · 前往售票处旁登船')
      close()
      return
    }
    if (!canAfford) {
      useUI.getState().showToast(`金钱不足 · 需 ¥${cls.priceFiat.toLocaleString()}`)
      return
    }
    if (!meetsPiloting) {
      useUI.getState().showToast(`驾驶技能不足 · 需 ≥ ${PILOTING_REQUIRED}`)
      return
    }
    const m = player.get(Money)
    if (!m || m.amount < cls.priceFiat) return
    player.set(Money, { amount: m.amount - cls.priceFiat })
    const f = player.get(Flags)
    const next = f ? { flags: { ...f.flags, shipOwned: true } } : { flags: { shipOwned: true } }
    if (player.has(Flags)) player.set(Flags, next)
    else player.add(Flags(next))
    useUI.getState().showToast('飞船已停泊在冯·布劳恩港 · 前往售票处旁登船')
    close()
  }

  const defaultWeaponLabels = cls.defaultWeapons
    .filter((wid) => isWeaponId(wid))
    .map((wid) => getWeapon(wid).nameZh)

  let buyLabel = `购买 ¥${cls.priceFiat.toLocaleString()}`
  let buyDisabled = false
  if (alreadyOwned) {
    buyLabel = '已拥有'
    buyDisabled = true
  } else if (!meetsPiloting) {
    buyLabel = '驾驶技能不足'
    buyDisabled = true
  } else if (!canAfford) {
    buyLabel = '金钱不足'
    buyDisabled = true
  }

  return (
    <div className="status-overlay" onClick={close}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>安那海姆电子 · 二手船坞</h2>
          <button className="status-close" onClick={close} aria-label="关闭">✕</button>
        </header>
        <section className="status-section">
          <div className="shop-money">钱包: <span className="shop-money-amount">¥{playerMoney.toLocaleString()}</span></div>
          <div className="status-meta">驾驶 {piloting} / 需 {PILOTING_REQUIRED}</div>
        </section>
        <section className="status-section">
          <h3>{cls.nameZh}</h3>
          <p className="map-place-desc">{cls.descZh}</p>
          <div className="ship-dealer-stats">
            <div>船体 {cls.hullMax}</div>
            <div>装甲 {cls.armorMax}</div>
            <div>电荷池 {cls.fluxMax}</div>
            <div>燃料 {cls.fuelMax}</div>
            <div>补给 {cls.suppliesMax}</div>
            <div>武器槽 {cls.mounts.length}</div>
            <div>载员上限 {cls.crewMax}</div>
            {defaultWeaponLabels.length > 0 && (
              <div>预装武器 {defaultWeaponLabels.join(' / ')}</div>
            )}
          </div>
        </section>
        <section className="status-section">
          <div className="ship-dealer-actions">
            <button
              className="apt-row-buy"
              disabled={buyDisabled}
              onClick={buy}
            >
              {buyLabel}
            </button>
          </div>
          {!alreadyOwned && !meetsPiloting && (
            <p className="map-place-desc">驾驶技能不足 · AE 销售拒绝交付。</p>
          )}
          {!alreadyOwned && meetsPiloting && !canAfford && (
            <p className="map-place-desc">现金不足 · 请先攒齐货款。</p>
          )}
        </section>
      </div>
    </div>
  )
}
