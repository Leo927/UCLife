// Phase 6.2.5.B — AE vehicle (MS / fighter / MW) sales branch. Parallel
// to aeShipSales: each rep sells exactly one MS class per
// `fleetConfig.vehicleSalesRepCatalog`. The buy gate is (1) money, (2)
// the chosen hangar advertises at least one MS-fitting slot class; on
// click the broker enqueues an MsDeliveryRow on the target Hangar and
// the Ms entity materializes only at receive-MS-delivery time (hangar
// manager click).

import { useState } from 'react'
import { useTrait, useQueryFirst, useQuery } from 'koota/react'
import {
  IsPlayer, Money, Building, Hangar, EntityKey, Job, Workstation,
} from '../../../ecs/traits'
import { useScene } from '../../../sim/scene'
import { world } from '../../../ecs/world'
import { getMsClass } from '../../../data/ms'
import { dialogueText } from '../../../data/dialogueText'
import { useUI } from '../../uiStore'
import { useClock, gameDayNumber } from '../../../sim/clock'
import { fleetConfig } from '../../../config'
import { enqueueMsDelivery } from '../../../systems/msDelivery'
import { fittingSlotClasses } from '../../../data/facilityTypes'
import type { DialogueCtx, DialogueNode } from '../types'

export function aeVehicleSalesBranch(ctx: DialogueCtx): DialogueNode | null {
  if (!ctx.roles.isAEVehicleSalesOnDuty) return null
  const wsEnt = ctx.npc.get(Job)?.workstation ?? null
  const specId = wsEnt?.get(Workstation)?.specId ?? ''
  const entry = fleetConfig.vehicleSalesRepCatalog[specId]
  if (!entry) return null
  return {
    id: 'aeVehicleSales',
    label: dialogueText.buttons.aeVehicleSales,
    info: dialogueText.branches.aeVehicleSales.title,
    specialUI: () => <AEVehicleSalesPanel msClassId={entry.msClassId} />,
  }
}

interface HangarOption {
  buildingKey: string
  sceneId: string
  labelZh: string
  hasMsSlot: boolean
}

function AEVehicleSalesPanel({ msClassId }: { msClassId: string }) {
  const player = useQueryFirst(IsPlayer)
  const money = useTrait(player, Money)
  const t = dialogueText.branches.aeVehicleSales

  // Active-scene picker mirrors aeShipSales — the broker only ships to
  // hangars reachable from its own scene. Cross-scene delivery routes
  // through the future MS-broker proper (Design/fleet.md).
  useScene((s) => s.activeId)
  const localHangars = useQuery(Building, Hangar, EntityKey)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  if (!player) return null

  const playerMoney = money?.amount ?? 0
  const cls = getMsClass(msClassId)
  const leadDays = fleetConfig.vehicleDeliveryDays

  // A hangar can host an MS iff its slotCapacity advertises at least one
  // 'ms'-fitting class. MS at a depot don't consume Ship slot capacity
  // (different storage axis), so we only gate on capability.
  const options: HangarOption[] = []
  for (const b of localHangars) {
    const h = b.get(Hangar)!
    const fitting = fittingSlotClasses(h.slotCapacity, 'ms')
    options.push({
      buildingKey: b.get(EntityKey)!.key,
      sceneId: 'active',
      labelZh: b.get(Building)!.label || '',
      hasMsSlot: fitting.length > 0,
    })
  }

  const firstFit = options.find((o) => o.hasMsSlot)
  const fallback = firstFit ?? options[0] ?? null
  const selected = options.find((o) => o.buildingKey === selectedKey) ?? fallback

  const canAfford = playerMoney >= cls.priceFiat
  const slotOk = !!selected && selected.hasMsSlot

  let buyLabel = `${t.buyButton} ¥${cls.priceFiat.toLocaleString()}`
  let buyDisabled = false
  if (!canAfford) { buyLabel = t.buyDisabledMoney; buyDisabled = true }
  else if (!slotOk) { buyLabel = t.buyDisabledNoSlot; buyDisabled = true }

  const buy = () => {
    if (!selected) {
      useUI.getState().showToast(t.toastNoHangar)
      return
    }
    if (!slotOk) {
      useUI.getState().showToast(t.gateNoSlot)
      return
    }
    if (!canAfford) {
      useUI.getState().showToast(t.gateNoMoney.replace('{price}', cls.priceFiat.toLocaleString()))
      return
    }
    let hangarEnt = null
    for (const e of world.query(Building, Hangar, EntityKey)) {
      if (e.get(EntityKey)!.key === selected.buildingKey) { hangarEnt = e; break }
    }
    if (!hangarEnt) {
      useUI.getState().showToast(t.toastNoHangar)
      return
    }
    const m = player.get(Money)
    if (!m || m.amount < cls.priceFiat) return
    player.set(Money, { amount: m.amount - cls.priceFiat })
    const today = gameDayNumber(useClock.getState().gameDate)
    enqueueMsDelivery(hangarEnt, cls.id, today, leadDays)
    useUI.getState().showToast(
      t.toastBought
        .replace('{ms}', cls.nameZh)
        .replace('{days}', String(leadDays))
        .replace('{hangar}', selected.labelZh),
    )
    useUI.getState().setDialogNPC(null)
  }

  return (
    <>
      <h3>{t.title}</h3>
      <div className="shop-money">{t.moneyLabel}: <span className="shop-money-amount">¥{playerMoney.toLocaleString()}</span></div>
      <h3 style={{ marginTop: 8 }}>{cls.nameZh}</h3>
      <p className="map-place-desc">{cls.descZh}</p>
      <div className="ship-dealer-stats">
        <div>{t.statHull} {cls.hullMax}</div>
        <div>{t.statArmor} {cls.armorMax}</div>
        <div>{t.statSpeed} {cls.topSpeed}</div>
        <div>{t.statSupplyPerDay} {cls.supplyPerDay}</div>
        <div>{t.statHardpoints} {cls.hardpoints.length}</div>
      </div>

      <h4 style={{ marginTop: 8 }}>{t.deliverHeader}</h4>
      {options.length === 0 ? (
        <p className="map-place-desc">{t.gateNoHangar}</p>
      ) : (
        <ul className="dialog-options" style={{ listStyle: 'none', padding: 0 }}>
          {options.map((o) => {
            const isSel = selected?.buildingKey === o.buildingKey
            return (
              <li key={o.buildingKey} className="dev-row">
                <label className="dev-key" style={{ cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="ae-vb-vehicle-hangar-target"
                    checked={isSel}
                    onChange={() => setSelectedKey(o.buildingKey)}
                  />
                  {' '}{o.labelZh}
                </label>
                <span>
                  {t.slotLabel}
                  {!o.hasMsSlot && <span> · {t.slotFull}</span>}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <div className="ship-dealer-actions" style={{ marginTop: 8 }}>
        <button className="apt-row-buy" disabled={buyDisabled} onClick={buy}>{buyLabel}</button>
      </div>
      {!slotOk && options.length > 0 && (
        <p className="map-place-desc">{t.gateNoSlot}</p>
      )}
      {slotOk && !canAfford && (
        <p className="map-place-desc">{t.gateNoMoney.replace('{price}', cls.priceFiat.toLocaleString())}</p>
      )}
    </>
  )
}
