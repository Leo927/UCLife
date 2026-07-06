// Phase 6.2.5.A — MS retrofit panel opened from the hangar terminal.
// Slice A verb: weapon swap. Picker shows weapons in the player's parts
// inventory whose mountType matches the selected hardpoint. Confirm
// writes mountedWeapons[hardpointId] and adjusts inventory count.

import { useTrait } from 'koota/react'
import { Ms, MsStatSheet, PlayerPartsInventory, EntityKey, MS_ROLE_TAGS, type MsRoleTag } from '../ecs/traits'
import { getMsClass } from '../data/ms'
import { msConfig } from '../config'
import { getMsWeapon, getMsWeaponsForType } from '../data/ms-weapons'
import { MS_FRAME_MOD_LIST, getMsFrameMod } from '../data/ms-frame-mods'
import { useUI } from './uiStore'
import { getWorld } from '../ecs/world'
import { playUi } from '../audio/player'
import { installFrameModEffect, uninstallFrameModEffect } from '../ecs/msEffects'
import { getStat } from '../stats/sheet'

const SHIP_SCENE_ID = 'playerShipInterior'

function findMsEntity(msKey: string) {
  if (!msKey) return null
  const w = getWorld(SHIP_SCENE_ID)
  for (const ent of w.query(Ms, EntityKey)) {
    if (ent.get(EntityKey)!.key === msKey) return ent
  }
  return null
}

// Task 8 — the retrofit panel now opens from depot scenes too (the
// msTerminal reachability fix in interaction.ts), whose WorldProvider is
// scoped to that depot scene, not playerShipInterior. PlayerPartsInventory
// is a singleton that only ever lives in playerShipInterior, so it must be
// resolved via a direct getWorld(SHIP_SCENE_ID) query (like findMsEntity
// above) rather than useQueryFirst, which reads the *active* WorldProvider
// scene and would silently miss it from any other scene.
function findPartsEntity() {
  const w = getWorld(SHIP_SCENE_ID)
  for (const ent of w.query(PlayerPartsInventory)) return ent
  return null
}

export function MsRetrofitPanel() {
  const msRetrofitKey = useUI((s) => s.msRetrofitKey)
  const setMsRetrofit = useUI((s) => s.setMsRetrofit)

  const msEnt = msRetrofitKey ? findMsEntity(msRetrofitKey) : null
  const msData = useTrait(msEnt ?? null, Ms)

  const partsEnt = findPartsEntity()
  const partsData = useTrait(partsEnt, PlayerPartsInventory)

  if (!msRetrofitKey || !msData || !partsData) return null

  const cls = getMsClass(msData.templateId)
  const onClose = () => {
    playUi('ui.npc.close')
    setMsRetrofit(null)
  }

  // Phase 6.2.5.C — frame mod install / uninstall is gated on the MS
  // being at a depot POI (per the user-confirmed plan; on-ship modding
  // unlocks later via a perk). dockedAtPoiId is the field set when an
  // MS is in a depot hangar; storedOnShipKey wins for aboard-ship MS.
  const atDepot = msData.dockedAtPoiId !== '' && msData.storedOnShipKey === ''
  const sheet = msEnt?.get(MsStatSheet)?.sheet
  const frameSlotsCap = sheet ? Math.round(getStat(sheet, 'frameSlots')) : cls.frameSlots
  const usedSlots = msData.frameMods.reduce(
    (sum, id) => sum + getMsFrameMod(id).slotCount, 0,
  )
  const remainingSlots = frameSlotsCap - usedSlots

  function onInstallMod(modId: string) {
    if (!atDepot) return
    const msE = findMsEntity(msRetrofitKey!)
    if (!msE) return
    const def = getMsFrameMod(modId)
    if (def.slotCount > remainingSlots) return
    const partsE = partsEnt
    if (!partsE) return
    const curParts = partsE.get(PlayerPartsInventory)!
    const stock = curParts.frameMods[modId] ?? 0
    if (stock <= 0) return
    if (!installFrameModEffect(msE, modId)) return
    const nextParts = { ...curParts.frameMods }
    if (stock - 1 <= 0) delete nextParts[modId]
    else nextParts[modId] = stock - 1
    partsE.set(PlayerPartsInventory, { ...curParts, frameMods: nextParts })
    playUi('ui.hr.accept')
  }

  function onUninstallMod(modId: string) {
    if (!atDepot) return
    const msE = findMsEntity(msRetrofitKey!)
    if (!msE) return
    const partsE = partsEnt
    if (!partsE) return
    if (!uninstallFrameModEffect(msE, modId)) return
    const curParts = partsE.get(PlayerPartsInventory)!
    partsE.set(PlayerPartsInventory, {
      ...curParts,
      frameMods: {
        ...curParts.frameMods,
        [modId]: (curParts.frameMods[modId] ?? 0) + 1,
      },
    })
    playUi('ui.hr.accept')
  }

  function onSetRoleTag(roleTag: MsRoleTag) {
    const msE = findMsEntity(msRetrofitKey!)
    if (!msE) return
    const cur = msE.get(Ms)!
    if (cur.roleTag === roleTag) return
    msE.set(Ms, { ...cur, roleTag })
    playUi('ui.hr.accept')
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
    partsE.set(PlayerPartsInventory, { ...curParts, weapons: updatedWeapons })

    playUi('ui.hr.accept')
  }

  return (
    <div className="status-overlay" onClick={onClose}>
      <div className="status-panel" data-testid="ms-retrofit-panel" onClick={(e) => e.stopPropagation()}>
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
          <h3 className="status-section-title">出击编队 · 角色</h3>
          <div className="status-meta">决定僚机 AI 的目标偏好与交战距离；玩家亲自驾驶时忽略。</div>
          <div style={{ marginTop: 8 }}>
            {MS_ROLE_TAGS.map((tag) => {
              const row = msConfig.roleTagAi[tag]
              const active = msData.roleTag === tag
              return (
                <button
                  key={tag}
                  className="status-close"
                  data-role-tag={tag}
                  data-role-tag-active={active ? 'true' : 'false'}
                  disabled={active}
                  style={{
                    marginRight: 6, marginTop: 4, fontSize: '0.85em', padding: '2px 8px',
                    opacity: active ? 1 : 0.75,
                    fontWeight: active ? 700 : 400,
                  }}
                  onClick={() => onSetRoleTag(tag)}
                  title={row.descZh}
                >
                  {active ? `▸ ${row.labelZh}` : row.labelZh}
                </button>
              )
            })}
          </div>
        </section>

        <section className="status-section">
          <h3 className="status-section-title">机体改装 · 框架</h3>
          <div className="combat-tally-row">
            <span className="combat-tally-row-label">框架槽</span>
            <span className="combat-tally-row-value">{usedSlots} / {frameSlotsCap}</span>
          </div>
          {!atDepot && (
            <div className="status-meta">仅可在地面 / 船坞机库改装框架。当前 MS 在舰内，需先转运到机库。</div>
          )}
          {msData.frameMods.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <span style={{ fontSize: '0.8em', opacity: 0.7 }}>已装：</span>
              {msData.frameMods.map((id) => {
                const def = getMsFrameMod(id)
                return (
                  <div key={id} style={{ paddingLeft: 12, marginTop: 4 }}>
                    <span style={{ fontSize: '0.85em' }}>{def.nameZh} · {def.slotCount} 槽</span>
                    {atDepot && (
                      <button
                        className="status-close"
                        style={{ marginLeft: 8, fontSize: '0.8em', padding: '2px 8px' }}
                        onClick={() => onUninstallMod(id)}
                      >拆除</button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {atDepot && partsData.frameMods && (
            <div style={{ marginTop: 8 }}>
              <span style={{ fontSize: '0.8em', opacity: 0.7 }}>仓库可用：</span>
              {MS_FRAME_MOD_LIST.map((def) => {
                const stock = partsData.frameMods?.[def.id] ?? 0
                if (stock <= 0) return null
                if (msData.frameMods.includes(def.id)) return null
                const tooBig = def.slotCount > remainingSlots
                return (
                  <div key={def.id} style={{ paddingLeft: 12, marginTop: 4 }}>
                    <span style={{ fontSize: '0.85em' }}>
                      {def.nameZh} · {def.slotCount} 槽 · ×{stock}
                    </span>
                    <button
                      className="status-close"
                      data-install-frame-mod={def.id}
                      disabled={tooBig}
                      style={{ marginLeft: 8, fontSize: '0.8em', padding: '2px 8px' }}
                      onClick={() => onInstallMod(def.id)}
                    >{tooBig ? '槽位不足' : '安装'}</button>
                  </div>
                )
              })}
            </div>
          )}
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
