import { useQueryFirst, useTrait } from 'koota/react'
import { IsPlayer, Money, Attributes, Flags } from '../../../ecs/traits'
import { useUI } from '../../uiStore'
import { getShipClass } from '../../../data/ships'
import { getWeapon, isWeaponId } from '../../../data/weapons'
import { getSkillXp } from '../../../character/skills'
import { playUi } from '../../../audio/player'
import { dialogueText } from '../../../data/dialogueText'
import type { DialogueCtx, DialogueNode } from '../types'

const SHIP_ID = 'lightFreighter'
const PILOTING_REQUIRED = 10

export function shipDealerBranch(ctx: DialogueCtx): DialogueNode | null {
  if (!ctx.roles.isShipDealerOnDuty) return null
  return {
    id: 'shipDealer',
    label: dialogueText.buttons.shipDealer,
    info: dialogueText.branches.shipDealer.title,
    specialUI: () => <ShipDealerPanel />,
  }
}

function ShipDealerPanel() {
  const player = useQueryFirst(IsPlayer)
  const money = useTrait(player, Money)
  void useTrait(player, Attributes)
  const flags = useTrait(player, Flags)

  if (!player) return null

  const cls = getShipClass(SHIP_ID)
  const playerMoney = money?.amount ?? 0
  const piloting = getSkillXp(player, 'piloting')
  const alreadyOwned = !!flags?.flags.shipOwned
  const canAfford = playerMoney >= cls.priceFiat
  const meetsPiloting = piloting >= PILOTING_REQUIRED

  const close = () => {
    playUi('ui.ship-dealer.close')
    useUI.getState().setDialogNPC(null)
  }

  const buy = () => {
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
    playUi('ui.ship-dealer.buy')
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
  if (alreadyOwned) { buyLabel = '已拥有'; buyDisabled = true }
  else if (!meetsPiloting) { buyLabel = '驾驶技能不足'; buyDisabled = true }
  else if (!canAfford) { buyLabel = '金钱不足'; buyDisabled = true }

  return (
    <>
      <h3>{dialogueText.branches.shipDealer.title}</h3>
      <div className="shop-money">钱包: <span className="shop-money-amount">¥{playerMoney.toLocaleString()}</span></div>
      <div className="status-meta">驾驶 {piloting} / 需 {PILOTING_REQUIRED}</div>
      <h3 style={{ marginTop: 8 }}>{cls.nameZh}</h3>
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
      <div className="ship-dealer-actions" style={{ marginTop: 8 }}>
        <button className="apt-row-buy" disabled={buyDisabled} onClick={buy}>{buyLabel}</button>
      </div>
      {!alreadyOwned && !meetsPiloting && (
        <p className="map-place-desc">驾驶技能不足 · AE 销售拒绝交付。</p>
      )}
      {!alreadyOwned && meetsPiloting && !canAfford && (
        <p className="map-place-desc">现金不足 · 请先攒齐货款。</p>
      )}
    </>
  )
}
