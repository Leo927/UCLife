// Issue #64 — AE MS-parts broker dialogue branch. Parallel to
// aeVehicleSales, but the SKU is an MS weapon or frame mod and the
// transaction is immediate (no delivery queue / hangar slot): buy debits
// Money and credits PlayerPartsInventory right away. Catalog (which ids
// each dealer sells) + price-derivation constants live in fleet.json5;
// the shared buyPart() in systems/partsSales runs the transaction.

import { useTrait, useQueryFirst } from 'koota/react'
import { IsPlayer, Money, PlayerPartsInventory, Job, Workstation } from '../../../ecs/traits'
import { dialogueText } from '../../../data/dialogueText'
import { fleetConfig } from '../../../config'
import { getMsWeapon } from '../../../data/ms-weapons'
import { getMsFrameMod } from '../../../data/ms-frame-mods'
import { partPrice } from '../../../data/partsPricing'
import { buyPart } from '../../../systems/partsSales'
import { useUI } from '../../uiStore'
import type { DialogueCtx, DialogueNode } from '../types'

export function aePartsSalesBranch(ctx: DialogueCtx): DialogueNode | null {
  if (!ctx.roles.isAEPartsDealerOnDuty) return null
  const wsEnt = ctx.npc.get(Job)?.workstation ?? null
  const specId = wsEnt?.get(Workstation)?.specId ?? ''
  const entry = fleetConfig.partsSalesCatalog[specId]
  if (!entry || (entry.weapons.length === 0 && entry.frameMods.length === 0)) return null
  return {
    id: 'aePartsSales',
    label: dialogueText.buttons.aePartsSales,
    info: dialogueText.branches.aePartsSales.title,
    specialUI: () => <AEPartsSalesPanel specId={specId} />,
  }
}

function AEPartsSalesPanel({ specId }: { specId: string }) {
  const t = dialogueText.branches.aePartsSales
  const player = useQueryFirst(IsPlayer)
  const money = useTrait(player, Money)
  const partsEnt = useQueryFirst(PlayerPartsInventory)
  const inv = useTrait(partsEnt, PlayerPartsInventory)

  const entry = fleetConfig.partsSalesCatalog[specId]
  if (!player || !entry) return null
  const playerMoney = money?.amount ?? 0

  const buy = (kind: 'weapon' | 'frameMod', partId: string) => {
    const res = buyPart(specId, kind, partId)
    if (!res.ok) {
      if (res.reason === 'insufficient_funds') {
        useUI.getState().showToast(t.gateNoMoney.replace('{price}', String(partPrice(kind, partId))))
      }
      return
    }
    const nameZh = kind === 'weapon' ? getMsWeapon(partId).nameZh : getMsFrameMod(partId).nameZh
    useUI.getState().showToast(t.toastBought.replace('{part}', nameZh))
  }

  return (
    <>
      <h3>{t.title}</h3>
      <div className="hr-intro">{t.intro}</div>
      <div className="shop-money">{t.moneyLabel}: <span className="shop-money-amount">¥{playerMoney.toLocaleString()}</span></div>

      <h4 style={{ marginTop: 8 }}>{t.weaponsHeader}</h4>
      <ul className="dialog-options" style={{ listStyle: 'none', padding: 0 }}>
        {entry.weapons.map((id) => {
          const w = getMsWeapon(id)
          const price = partPrice('weapon', id)
          const owned = inv?.weapons[id] ?? 0
          const afford = playerMoney >= price
          return (
            <li key={id} className="dev-row" data-ae-parts-weapon={id}>
              <span className="dev-key">
                {w.nameZh}
                <span className="status-meta"> · {t.statDamage} {w.damage} · {t.statRange} {w.range}</span>
              </span>
              <span>
                {t.ownedLabel} {owned}
                <button
                  className="apt-row-buy"
                  style={{ marginLeft: 8 }}
                  disabled={!afford}
                  onClick={() => buy('weapon', id)}
                >
                  {afford ? `${t.buyButton} ¥${price.toLocaleString()}` : t.buyDisabledMoney}
                </button>
              </span>
            </li>
          )
        })}
      </ul>

      <h4 style={{ marginTop: 8 }}>{t.frameModsHeader}</h4>
      <ul className="dialog-options" style={{ listStyle: 'none', padding: 0 }}>
        {entry.frameMods.map((id) => {
          const m = getMsFrameMod(id)
          const price = partPrice('frameMod', id)
          const owned = inv?.frameMods[id] ?? 0
          const afford = playerMoney >= price
          return (
            <li key={id} className="dev-row" data-ae-parts-framemod={id}>
              <span className="dev-key">
                {m.nameZh}
                <span className="status-meta"> · {t.statSlots} {m.slotCount}</span>
              </span>
              <span>
                {t.ownedLabel} {owned}
                <button
                  className="apt-row-buy"
                  style={{ marginLeft: 8 }}
                  disabled={!afford}
                  onClick={() => buy('frameMod', id)}
                >
                  {afford ? `${t.buyButton} ¥${price.toLocaleString()}` : t.buyDisabledMoney}
                </button>
              </span>
            </li>
          )
        })}
      </ul>
    </>
  )
}
