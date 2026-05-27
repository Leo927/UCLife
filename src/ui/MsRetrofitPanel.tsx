// Phase 6.2.5.A — MS retrofit panel opened from the hangar terminal.
// Slice A verb: weapon swap. Picker shows weapons in the player's parts
// inventory whose mountType matches the selected hardpoint. Confirm
// writes mountedWeapons[hardpointId] and adjusts inventory count.

import { useQueryFirst, useTrait } from 'koota/react'
import { Ms, PlayerPartsInventory, EntityKey } from '../ecs/traits'
import { getMsClass } from '../data/ms'
import { getMsWeapon, getMsWeaponsForType } from '../data/ms-weapons'
import { useUI } from './uiStore'
import { getWorld } from '../ecs/world'
import { playUi } from '../audio/player'

const SHIP_SCENE_ID = 'playerShipInterior'

function findMsEntity(msKey: string) {
  if (!msKey) return null
  const w = getWorld(SHIP_SCENE_ID)
  for (const ent of w.query(Ms, EntityKey)) {
    if (ent.get(EntityKey)!.key === msKey) return ent
  }
  return null
}

export function MsRetrofitPanel() {
  const msRetrofitKey = useUI((s) => s.msRetrofitKey)
  const setMsRetrofit = useUI((s) => s.setMsRetrofit)

  const msEnt = msRetrofitKey ? findMsEntity(msRetrofitKey) : null
  const msData = useTrait(msEnt ?? null, Ms)

  const partsEnt = useQueryFirst(PlayerPartsInventory)
  const partsData = useTrait(partsEnt, PlayerPartsInventory)

  if (!msRetrofitKey || !msData || !partsData) return null

  const cls = getMsClass(msData.templateId)
  const onClose = () => {
    playUi('ui.npc.close')
    setMsRetrofit(null)
  }

  function onSwap(hardpointId: string, newWeaponId: string) {
    const msE = findMsEntity(msRetrofitKey!)
    if (!msE) return
    const cur = msE.get(Ms)!

    const partsE = partsEnt
    if (!partsE) return
    const curParts = partsE.get(PlayerPartsInventory)!

    const oldWeaponId = cur.mountedWeapons[hardpointId]

    const newWeaponCount = (curParts.weapons[newWeaponId] ?? 0) - 1
    if (newWeaponCount < 0) return

    const updatedWeapons = { ...curParts.weapons }
    if (newWeaponCount <= 0) {
      delete updatedWeapons[newWeaponId]
    } else {
      updatedWeapons[newWeaponId] = newWeaponCount
    }
    if (oldWeaponId && oldWeaponId !== newWeaponId) {
      updatedWeapons[oldWeaponId] = (updatedWeapons[oldWeaponId] ?? 0) + 1
    }

    msE.set(Ms, {
      ...cur,
      mountedWeapons: { ...cur.mountedWeapons, [hardpointId]: newWeaponId },
    })
    partsE.set(PlayerPartsInventory, { weapons: updatedWeapons })

    playUi('ui.hr.accept')
  }

  return (
    <div className="status-overlay" onClick={onClose}>
      <div className="status-panel" onClick={(e) => e.stopPropagation()}>
        <header className="status-header">
          <h2>MS 终端 · {msData.name || cls.nameZh}</h2>
          <button className="status-close" onClick={onClose} aria-label="关闭">✕</button>
        </header>

        <section className="status-section">
          <div className="combat-tally-row">
            <span className="combat-tally-row-label">机体</span>
            <span className="combat-tally-row-value">{cls.nameZh}</span>
          </div>
          <div className="combat-tally-row">
            <span className="combat-tally-row-label">舰体</span>
            <span className="combat-tally-row-value">{msData.hullCurrent} / {msData.hullMax}</span>
          </div>
          <div className="combat-tally-row">
            <span className="combat-tally-row-label">装甲</span>
            <span className="combat-tally-row-value">{msData.armorCurrent} / {msData.armorMax}</span>
          </div>
        </section>

        <section className="status-section">
          <h3 className="status-section-title">武装改装</h3>
          {cls.hardpoints.map((hp) => {
            const equippedId = msData.mountedWeapons[hp.id] ?? hp.defaultWeaponId
            const equipped = getMsWeapon(equippedId)
            const compatible = getMsWeaponsForType(hp.type)
            const available = compatible.filter(
              (w) => w.id !== equippedId && (partsData.weapons[w.id] ?? 0) > 0,
            )

            return (
              <div key={hp.id} style={{ marginBottom: 12 }}>
                <div className="combat-tally-row">
                  <span className="combat-tally-row-label">挂点 {hp.id}</span>
                  <span className="combat-tally-row-value">{equipped.nameZh}</span>
                </div>
                {available.length > 0 && (
                  <div style={{ paddingLeft: 12, marginTop: 4 }}>
                    <span style={{ fontSize: '0.8em', opacity: 0.7 }}>可替换：</span>
                    {available.map((w) => (
                      <button
                        key={w.id}
                        className="status-close"
                        style={{ marginRight: 6, marginTop: 4, fontSize: '0.85em', padding: '2px 8px' }}
                        onClick={() => onSwap(hp.id, w.id)}
                      >
                        {w.nameZh} ×{partsData.weapons[w.id]}
                      </button>
                    ))}
                  </div>
                )}
                {available.length === 0 && (
                  <div style={{ paddingLeft: 12, marginTop: 2, fontSize: '0.8em', opacity: 0.5 }}>
                    无备用武器
                  </div>
                )}
              </div>
            )
          })}
        </section>
      </div>
    </div>
  )
}
