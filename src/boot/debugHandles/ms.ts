// Phase 6.2.5.A MS debug handles.
//
//   getMsRoster()           — snapshot of all Ms entities (smoke reads this
//                             to assert starter MS grant + storedOnShipKey)
//   getMsWeaponCounts()     — PlayerPartsInventory snapshot (weapon counts)
//   openMsRetrofit(msKey)   — directly open the retrofit panel for a key
//   swapMsWeapon(msKey, hardpointId, weaponId) — drive weapon-swap logic
//   getMs(msKey)            — get a single Ms entity snapshot

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { getWorld } from '../../ecs/world'
import { Ms, PlayerPartsInventory, EntityKey } from '../../ecs/traits'
import { useUI } from '../../ui/uiStore'

const SHIP_SCENE_ID = 'playerShipInterior'

interface MsSnapshot {
  key: string
  templateId: string
  name: string
  hullCurrent: number
  hullMax: number
  armorCurrent: number
  armorMax: number
  mountedWeapons: Record<string, string>
  storedOnShipKey: string
  bayIndex: number
}

registerDebugHandle('getMsRoster', (): MsSnapshot[] => {
  const w = getWorld(SHIP_SCENE_ID)
  const result: MsSnapshot[] = []
  for (const ent of w.query(Ms, EntityKey)) {
    const ms = ent.get(Ms)!
    const key = ent.get(EntityKey)!.key
    result.push({
      key,
      templateId: ms.templateId,
      name: ms.name,
      hullCurrent: ms.hullCurrent,
      hullMax: ms.hullMax,
      armorCurrent: ms.armorCurrent,
      armorMax: ms.armorMax,
      mountedWeapons: { ...ms.mountedWeapons },
      storedOnShipKey: ms.storedOnShipKey,
      bayIndex: ms.bayIndex,
    })
  }
  return result
})

registerDebugHandle('getMsWeaponCounts', (): Record<string, number> => {
  const w = getWorld(SHIP_SCENE_ID)
  for (const ent of w.query(PlayerPartsInventory)) {
    return { ...ent.get(PlayerPartsInventory)!.weapons }
  }
  return {}
})

registerDebugHandle('getMs', (msKey: string): MsSnapshot | null => {
  const w = getWorld(SHIP_SCENE_ID)
  for (const ent of w.query(Ms, EntityKey)) {
    if (ent.get(EntityKey)!.key === msKey) {
      const ms = ent.get(Ms)!
      return {
        key: msKey,
        templateId: ms.templateId,
        name: ms.name,
        hullCurrent: ms.hullCurrent,
        hullMax: ms.hullMax,
        armorCurrent: ms.armorCurrent,
        armorMax: ms.armorMax,
        mountedWeapons: { ...ms.mountedWeapons },
        storedOnShipKey: ms.storedOnShipKey,
        bayIndex: ms.bayIndex,
      }
    }
  }
  return null
})

registerDebugHandle('openMsRetrofit', (msKey: string) => {
  useUI.getState().setMsRetrofit(msKey)
})

registerDebugHandle('swapMsWeapon', (msKey: string, hardpointId: string, newWeaponId: string): boolean => {
  const w = getWorld(SHIP_SCENE_ID)
  let msEnt = null
  for (const ent of w.query(Ms, EntityKey)) {
    if (ent.get(EntityKey)!.key === msKey) { msEnt = ent; break }
  }
  if (!msEnt) return false

  let partsEnt = null
  for (const ent of w.query(PlayerPartsInventory)) { partsEnt = ent; break }
  if (!partsEnt) return false

  const curMs = msEnt.get(Ms)!
  const curParts = partsEnt.get(PlayerPartsInventory)!

  const oldWeaponId = curMs.mountedWeapons[hardpointId]
  const newCount = (curParts.weapons[newWeaponId] ?? 0) - 1
  if (newCount < 0) return false

  const updatedWeapons = { ...curParts.weapons }
  if (newCount <= 0) {
    delete updatedWeapons[newWeaponId]
  } else {
    updatedWeapons[newWeaponId] = newCount
  }
  if (oldWeaponId && oldWeaponId !== newWeaponId) {
    updatedWeapons[oldWeaponId] = (updatedWeapons[oldWeaponId] ?? 0) + 1
  }

  msEnt.set(Ms, {
    ...curMs,
    mountedWeapons: { ...curMs.mountedWeapons, [hardpointId]: newWeaponId },
  })
  partsEnt.set(PlayerPartsInventory, { weapons: updatedWeapons })
  return true
})
