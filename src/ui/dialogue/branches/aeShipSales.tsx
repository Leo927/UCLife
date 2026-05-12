// Phase 6.2.C1 — AE Von Braun spaceport ship sales branch.
// Phase 6.2.C2 — generalized so each AE sales rep sells exactly one hull,
// per the fleet.json5 salesRepCatalog mapping (specId → shipClassId).
// VB rep sells the lunarMilitia light hull; Granada drydock rep sells
// the Pegasus-class capital. The buy gates on (1) money, (2) the chosen
// hangar having a free slot of the hull's hangarSlotClass; on click an
// in-transit row is enqueued on the target Hangar and the ship entity
// materializes only at receive-delivery time (hangar manager click).
//
// "Reachable" at 6.2.C2 = the rep's local hangar (active scene only):
// VB rep → VB surface hangar (smallCraft slots); Granada rep → Granada
// drydock (capital slots). Cross-hangar transfer is a 6.2.G concern.

import { useState } from 'react'
import { useTrait, useQueryFirst, useQuery } from 'koota/react'
import {
  IsPlayer, Money, Building, Hangar, EntityKey, Job, Workstation,
  type ShipDeliveryRow,
} from '../../../ecs/traits'
import { useScene } from '../../../sim/scene'
import { world } from '../../../ecs/world'
import { getShipClass } from '../../../data/ship-classes'
import { dialogueText } from '../../../data/dialogueText'
import { useUI } from '../../uiStore'
import { useClock, gameDayNumber } from '../../../sim/clock'
import { fleetConfig } from '../../../config'
import {
  enqueueDelivery, poiIdForHangarScene, deriveHangarOccupancy,
} from '../../../systems/shipDelivery'
import type { DialogueCtx, DialogueNode } from '../types'

// Per-class delivery lead-time lookup. Civilian/merc hulls slot into
// smallCraft bays and ship on the lightHull schedule; capital tonnage
// ships on the longer capital schedule.
function leadTimeForClass(hangarSlotClass: string): number {
  return hangarSlotClass === 'capital'
    ? fleetConfig.delivery.capital
    : fleetConfig.delivery.lightHull
}

export function aeShipSalesBranch(ctx: DialogueCtx): DialogueNode | null {
  if (!ctx.roles.isAEShipSalesOnDuty) return null
  // The npc's workstation specId picks the hull this rep sells; if the
  // catalog has no entry (e.g. a misconfigured spec), bail rather than
  // render an empty panel.
  const wsEnt = ctx.npc.get(Job)?.workstation ?? null
  const specId = wsEnt?.get(Workstation)?.specId ?? ''
  const entry = fleetConfig.salesRepCatalog[specId]
  if (!entry) return null
  return {
    id: 'aeShipSales',
    label: dialogueText.buttons.aeShipSales,
    info: dialogueText.branches.aeShipSales.title,
    specialUI: () => <AEShipSalesPanel shipClassId={entry.shipClassId} />,
  }
}

interface HangarOption {
  buildingKey: string
  sceneId: string
  labelZh: string
  capacity: number
  occupied: number
}

function AEShipSalesPanel({ shipClassId }: { shipClassId: string }) {
  const player = useQueryFirst(IsPlayer)
  const money = useTrait(player, Money)
  const t = dialogueText.branches.aeShipSales

  // Subscribe to every Hangar in the active scene so the slot count
  // refreshes after a save/load or after a delivery is received. Each
  // rep is reached only from within its own scene (VB / Granada drydock),
  // so the active-scene query is the right local picker for both reps.
  const activeSceneId = useScene((s) => s.activeId)
  const localHangars = useQuery(Building, Hangar, EntityKey)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  if (!player) return null

  const playerMoney = money?.amount ?? 0

  // One product per rep, chosen by the sales-rep catalog.
  const cls = getShipClass(shipClassId)
  const leadDays = leadTimeForClass(cls.hangarSlotClass)

  // Gather reachable hangars in the active scene whose slot class matches
  // the hull. The tier (surface vs. drydock) follows from the hull's
  // hangarSlotClass — civilian/merc hulls slot into smallCraft (either
  // tier could host them, but at 6.2.C2 only the surface-tier VB hangar
  // has smallCraft slots reachable from the VB rep's scene); capital
  // hulls slot into capital (drydock-tier only, reachable from the
  // Granada rep's scene).
  const options: HangarOption[] = []
  for (const b of localHangars) {
    const h = b.get(Hangar)!
    const cap = h.slotCapacity[cls.hangarSlotClass] ?? 0
    if (cap <= 0) continue
    const poiId = poiIdForHangarScene(activeSceneId)
    const occ = poiId ? (deriveHangarOccupancy(poiId)[cls.hangarSlotClass] ?? 0) : 0
    const pending = h.pendingDeliveries.filter(
      (row) => getShipClass(row.shipClassId).hangarSlotClass === cls.hangarSlotClass,
    ).length
    const used = occ + pending
    options.push({
      buildingKey: b.get(EntityKey)!.key,
      sceneId: activeSceneId,
      labelZh: b.get(Building)!.label || activeSceneId,
      capacity: cap,
      occupied: used,
    })
  }

  // Default selection: first hangar with free slot. Fallback to first
  // listed hangar so the player sees the "no slot — rent at Von Braun
  // state hangar" message keyed to that hangar even when full.
  const firstFree = options.find((o) => o.occupied < o.capacity)
  const fallback = firstFree ?? options[0] ?? null
  const selected = options.find((o) => o.buildingKey === selectedKey) ?? fallback

  const canAfford = playerMoney >= cls.priceFiat
  const slotFree = !!selected && selected.occupied < selected.capacity

  let buyLabel = `${t.buyButton} ¥${cls.priceFiat.toLocaleString()}`
  let buyDisabled = false
  if (!canAfford) { buyLabel = t.buyDisabledMoney; buyDisabled = true }
  else if (!slotFree) { buyLabel = t.buyDisabledNoSlot; buyDisabled = true }

  const buy = () => {
    if (!selected) {
      useUI.getState().showToast(t.toastNoHangar)
      return
    }
    if (!slotFree) {
      useUI.getState().showToast(t.gateNoSlot)
      return
    }
    if (!canAfford) {
      useUI.getState().showToast(t.gateNoMoney.replace('{price}', cls.priceFiat.toLocaleString()))
      return
    }
    // Resolve the live hangar entity by buildingKey so the trait write
    // lands on the canonical entity (selected.buildingKey survives a
    // save/load round-trip; entity refs don't).
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
    enqueueDelivery(hangarEnt, cls.id, today, leadDays)
    useUI.getState().showToast(
      t.toastBought
        .replace('{ship}', cls.nameZh)
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
        <div>{t.statFuel} {cls.fuelMax}</div>
        <div>{t.statSupplies} {cls.suppliesMax}</div>
        <div>{t.statMounts} {cls.mounts.length}</div>
        <div>{t.statCrew} {cls.crewMax}</div>
        <div>{t.statSlot} {t.slotLabel[cls.hangarSlotClass]}</div>
      </div>

      <h4 style={{ marginTop: 8 }}>{t.deliverHeader}</h4>
      {options.length === 0 ? (
        <p className="map-place-desc">{t.gateNoHangar}</p>
      ) : (
        <ul className="dialog-options" style={{ listStyle: 'none', padding: 0 }}>
          {options.map((o) => {
            const free = o.occupied < o.capacity
            const isSel = selected?.buildingKey === o.buildingKey
            return (
              <li key={o.buildingKey} className="dev-row">
                <label className="dev-key" style={{ cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="ae-vb-hangar-target"
                    checked={isSel}
                    onChange={() => setSelectedKey(o.buildingKey)}
                  />
                  {' '}{o.labelZh}
                </label>
                <span>
                  {t.slotLabel[cls.hangarSlotClass]} {o.occupied} / {o.capacity}
                  {!free && <span> · {t.slotFull}</span>}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <div className="ship-dealer-actions" style={{ marginTop: 8 }}>
        <button className="apt-row-buy" disabled={buyDisabled} onClick={buy}>{buyLabel}</button>
      </div>
      {!slotFree && options.length > 0 && (
        <p className="map-place-desc">{t.gateNoSlot}</p>
      )}
      {slotFree && !canAfford && (
        <p className="map-place-desc">{t.gateNoMoney.replace('{price}', cls.priceFiat.toLocaleString())}</p>
      )}

      <PendingDeliveriesList currentClassId={cls.id} />
    </>
  )
}

function PendingDeliveriesList({ currentClassId }: { currentClassId: string }) {
  void currentClassId
  const t = dialogueText.branches.aeShipSales
  const allBuildings = useQuery(Building, Hangar, EntityKey)
  const today = gameDayNumber(useClock(s => s.gameDate))

  type Row = ShipDeliveryRow & { hangarLabel: string }
  const rows: Row[] = []
  for (const b of allBuildings) {
    const h = b.get(Hangar)!
    if (h.pendingDeliveries.length === 0) continue
    const lbl = b.get(Building)?.label ?? ''
    for (const d of h.pendingDeliveries) {
      rows.push({ ...d, hangarLabel: lbl })
    }
  }
  if (rows.length === 0) return null

  return (
    <section style={{ marginTop: 8 }}>
      <h4>{t.pendingHeader}</h4>
      <ul className="dialog-options" style={{ listStyle: 'none', padding: 0 }}>
        {rows.map((r, i) => {
          const cls = getShipClass(r.shipClassId)
          const remaining = Math.max(0, r.arrivalDay - today)
          const status = r.status === 'arrived' ? t.pendingArrived
            : t.pendingDays.replace('{n}', String(remaining))
          return (
            <li key={i} className="dev-row">
              <span className="dev-key">{cls.nameZh} → {r.hangarLabel}</span>
              <span>{status}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
