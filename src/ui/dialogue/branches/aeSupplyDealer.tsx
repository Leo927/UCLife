// Phase 6.2.F — AE supply dealer dialog branch. Player walks up to the
// dealer NPC at the AE Complex lobby kiosk; the talk-verb opens this
// panel. Two verbs:
//
//   • Order supply — pick destination hangar + quantity → pay
//     pricePerUnit × qty from player Money → enqueue a delivery on
//     the target hangar's pendingSupplyDeliveries queue with
//     `supplyDeliveryDays` days remaining.
//   • Order fuel — same shape, fuel pricing + queue.
//
// Pricing + delivery timing live in src/config/fleet.json5 (no magic
// numbers in TS). Hangar selection is whatever player-accessible
// hangars exist across all scenes (today: VB state hangar + Granada
// drydock); the dropdown shows the building's label off the host scene.

import { useState } from 'react'
import { useTrait, useQueryFirst } from 'koota/react'
import type { Entity } from 'koota'
import { Building, Character, Hangar, IsPlayer, Money, EntityKey } from '../../../ecs/traits'
import type { SupplyKind } from '../../../ecs/traits'
import { getWorld, SCENE_IDS } from '../../../ecs/world'
import { dialogueText } from '../../../data/dialogueText'
import { fleetConfig } from '../../../config'
import { enqueueSupplyDelivery } from '../../../systems/fleetSupplyDelivery'
import type { DialogueCtx, DialogueNode } from '../types'

export function aeSupplyDealerBranch(ctx: DialogueCtx): DialogueNode | null {
  if (!ctx.roles.isAeSupplyDealerOnDuty) return null
  return {
    id: 'aeSupplyDealer',
    label: dialogueText.buttons.aeSupplyDealer,
    info: (ctx.npc.get(Character)?.name ?? '商务') + dialogueText.branches.aeSupplyDealer.titleSuffix,
    specialUI: () => <AESupplyDealerPanel />,
  }
}

interface HangarRow {
  buildingKey: string
  label: string
  sceneId: string
  entity: Entity
}

function listHangars(): HangarRow[] {
  const out: HangarRow[] = []
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const ent of w.query(Building, Hangar, EntityKey)) {
      const bld = ent.get(Building)!
      const key = ent.get(EntityKey)!.key
      out.push({ buildingKey: key, label: bld.label, sceneId, entity: ent })
    }
  }
  return out
}

function AESupplyDealerPanel() {
  const t = dialogueText.branches.aeSupplyDealer
  const player = useQueryFirst(IsPlayer)
  const playerMoney = useTrait(player, Money)

  const hangars = listHangars()
  const [target, setTarget] = useState<string>(hangars[0]?.buildingKey ?? '')
  const [qtyMultiplier, setQtyMultiplier] = useState(1)
  const [reply, setReply] = useState<string | null>(null)

  if (hangars.length === 0) {
    return <p className="hr-intro">{t.noHangars}</p>
  }

  const quantum = fleetConfig.supplyOrderQuantum
  const qty = qtyMultiplier * quantum
  const targetRow = hangars.find((h) => h.buildingKey === target) ?? hangars[0]

  const place = (kind: SupplyKind) => {
    const unit = kind === 'supply' ? fleetConfig.supplyPricePerUnit : fleetConfig.fuelPricePerUnit
    const days = kind === 'supply' ? fleetConfig.supplyDeliveryDays : fleetConfig.fuelDeliveryDays
    const cost = unit * qty
    const have = playerMoney?.amount ?? 0
    if (qty <= 0) { setReply(t.orderInvalid); return }
    if (!player) return
    if (have < cost) {
      setReply(t.orderInsufficient.replace('{need}', String(cost)).replace('{have}', String(have)))
      return
    }
    player.set(Money, { amount: have - cost })
    enqueueSupplyDelivery(targetRow.entity, kind, qty, days)
    setReply(t.orderConfirmed.replace('{days}', String(days)))
  }

  const supplyTotal = fleetConfig.supplyPricePerUnit * qty
  const fuelTotal = fleetConfig.fuelPricePerUnit * qty

  return (
    <>
      <div className="hr-intro" style={{ whiteSpace: 'pre-line' }}>{t.intro}</div>

      <div className="dev-row" style={{ marginTop: 8 }}>
        <span className="dev-key">{t.targetHangarLabel}</span>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          data-supply-target
        >
          {hangars.map((h) => (
            <option key={h.buildingKey} value={h.buildingKey}>{h.label}</option>
          ))}
        </select>
      </div>

      <div className="dev-row">
        <span className="dev-key">{t.qtyLabel}</span>
        <button
          className="dialog-option"
          onClick={() => setQtyMultiplier((n) => Math.max(1, n - 1))}
          data-supply-qty-dec
        >−</button>
        <span data-supply-qty>{qty}</span>
        <button
          className="dialog-option"
          onClick={() => setQtyMultiplier((n) => n + 1)}
          data-supply-qty-inc
        >＋</button>
      </div>

      <div className="dev-row">
        <span className="dev-key">{t.priceLabel}</span>
        <span>
          {t.orderSupplyLabel} ¥{fleetConfig.supplyPricePerUnit} · {t.orderFuelLabel} ¥{fleetConfig.fuelPricePerUnit}
        </span>
      </div>

      {reply && <p className="dialog-response">{reply}</p>}

      <div className="dialog-options">
        <button
          className="dialog-option"
          onClick={() => place('supply')}
          data-supply-order="supply"
        >
          {t.orderSupplyLabel} · ¥{supplyTotal} · {fleetConfig.supplyDeliveryDays}{t.etaUnit}
        </button>
        <button
          className="dialog-option"
          onClick={() => place('fuel')}
          data-supply-order="fuel"
        >
          {t.orderFuelLabel} · ¥{fuelTotal} · {fleetConfig.fuelDeliveryDays}{t.etaUnit}
        </button>
      </div>
    </>
  )
}
