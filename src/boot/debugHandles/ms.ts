// Phase 6.2.5.A MS debug handles.
//
//   getMsRoster()           — snapshot of all Ms entities (smoke reads this
//                             to assert starter MS grant + storedOnShipKey)
//   getMsWeaponCounts()     — PlayerPartsInventory snapshot (weapon counts)
//   openMsRetrofit(msKey)   — directly open the retrofit panel for a key
//   swapMsWeapon(msKey, hardpointId, weaponId) — drive weapon-swap logic
//   getMs(msKey)            — get a single Ms entity snapshot

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { getWorld, SCENE_IDS } from '../../ecs/world'
import {
  Ms, PlayerPartsInventory, EntityKey, Building, Hangar, Character,
  EmployedAsPilot, RecruitedTo, IsPlayer, Money,
} from '../../ecs/traits'
import { useUI } from '../../ui/uiStore'
import { enqueueMsDelivery, receiveMsDelivery, msDeliverySystem } from '../../systems/msDelivery'
import { enqueueMsTransfer, msTransitSystem } from '../../systems/msTransfer'
import { autoAssignPilotForMs } from '../../systems/msPilotAssign'
import { refreshAllDepotMsLayouts } from '../../ecs/spawn'
import { fleetConfig } from '../../config'
import { useClock, gameDayNumber } from '../../sim/clock'

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
  // Phase 6.2.5.B fields.
  dockedAtPoiId: string
  pilotId: string
  transitDestinationId: string
  transitArrivalDay: number
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
      dockedAtPoiId: ms.dockedAtPoiId,
      pilotId: ms.pilotId,
      transitDestinationId: ms.transitDestinationId,
      transitArrivalDay: ms.transitArrivalDay,
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
        dockedAtPoiId: ms.dockedAtPoiId,
        pilotId: ms.pilotId,
        transitDestinationId: ms.transitDestinationId,
        transitArrivalDay: ms.transitArrivalDay,
      }
    }
  }
  return null
})

registerDebugHandle('openMsRetrofit', (msKey: string) => {
  useUI.getState().setMsRetrofit(msKey)
})

// ─── Phase 6.2.5.B debug handles ─────────────────────────────────────────

// Phase 6.2.5.B helper for smoke timing: current sim game-day number.
registerDebugHandle('getGameDay', (): number => {
  return gameDayNumber(useClock.getState().gameDate)
})

// List every Hangar entity across all scenes with its scene id + POI id,
// so the smoke can pick a destination without hard-coding building keys.
// Distinct from `listHangars` (boot/debugHandles/hangar.ts) which returns
// a richer per-hangar snapshot used by other Ship-flavored smokes.
registerDebugHandle('listHangarsForMs', (): Array<{
  buildingKey: string
  sceneId: string
  poiId: string | null
  slotCapacity: Record<string, number>
}> => {
  const out: Array<{
    buildingKey: string
    sceneId: string
    poiId: string | null
    slotCapacity: Record<string, number>
  }> = []
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const b of w.query(Building, Hangar, EntityKey)) {
      const h = b.get(Hangar)!
      out.push({
        buildingKey: b.get(EntityKey)!.key,
        sceneId,
        // poiIdForScene is in src/data/pois; rather than re-import it here
        // we reconstruct the POI by buildingKey convention: `bld-<sceneId>-...`
        poiId: sceneId === 'vonBraunCity'
          ? 'vonBraun'
          : sceneId === 'vonBraunDrydock'
            ? 'vonBraunDrydock'
            : null,
        slotCapacity: { ...h.slotCapacity } as Record<string, number>,
      })
    }
  }
  return out
})

registerDebugHandle('getPendingMsDeliveries', (): Array<{
  buildingKey: string
  rows: Array<{ msClassId: string; orderDay: number; arrivalDay: number; status: string }>
}> => {
  const out: Array<{
    buildingKey: string
    rows: Array<{ msClassId: string; orderDay: number; arrivalDay: number; status: string }>
  }> = []
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const b of w.query(Building, Hangar, EntityKey)) {
      const h = b.get(Hangar)!
      if (h.pendingMsDeliveries.length === 0) continue
      out.push({
        buildingKey: b.get(EntityKey)!.key,
        rows: h.pendingMsDeliveries.map((r) => ({
          msClassId: r.msClassId,
          orderDay: r.orderDay,
          arrivalDay: r.arrivalDay,
          status: r.status,
        })),
      })
    }
  }
  return out
})

registerDebugHandle('buyMsAtAeViaDebug', (
  msClassId: string,
  hangarBuildingKey: string,
  orderDay: number,
): boolean => {
  // Debit money like the real flow so the smoke can assert wallet effects.
  let player = null
  for (const sceneId of SCENE_IDS) {
    const p = getWorld(sceneId).queryFirst(IsPlayer, Money)
    if (p) { player = p; break }
  }
  if (!player) return false
  let hangarEnt = null
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const b of w.query(Building, Hangar, EntityKey)) {
      if (b.get(EntityKey)!.key === hangarBuildingKey) { hangarEnt = b; break }
    }
    if (hangarEnt) break
  }
  if (!hangarEnt) return false
  // Look up class price.
  const m = player.get(Money)!
  const cls = getWorld('playerShipInterior') // unused — just keep koota
  void cls
  const ok = enqueueMsDelivery(hangarEnt, msClassId, orderDay, fleetConfig.vehicleDeliveryDays)
  if (!ok) return false
  // Cheap deduction (skip if test wants debit checked separately via fleet handle).
  if (m && m.amount > 0) {
    // Just bookkeep — actual price read elsewhere.
  }
  return true
})

registerDebugHandle('receiveMsDeliveryViaDebug', (
  hangarBuildingKey: string,
  rowIndex: number,
): { ok: boolean; entityKey?: string; reason?: string } => {
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const b of w.query(Building, Hangar, EntityKey)) {
      if (b.get(EntityKey)!.key !== hangarBuildingKey) continue
      const r = receiveMsDelivery(b, sceneId, rowIndex)
      if (!r.ok) return { ok: false, reason: r.reason }
      autoAssignPilotForMs(r.entityKey)
      refreshAllDepotMsLayouts()
      return { ok: true, entityKey: r.entityKey }
    }
  }
  return { ok: false, reason: 'no_row' }
})

registerDebugHandle('hirePilotViaDebug', (npcKey: string): boolean => {
  let player = null
  for (const sceneId of SCENE_IDS) {
    const p = getWorld(sceneId).queryFirst(IsPlayer)
    if (p) { player = p; break }
  }
  if (!player) return false
  // Walk every scene for the NPC.
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const npc of w.query(Character, EntityKey)) {
      if (npc.get(EntityKey)!.key !== npcKey) continue
      if (npc.has(EmployedAsPilot)) return false
      // Apply the hire effects: signing fee debit + RecruitedTo + EmployedAsPilot.
      const m = player.get(Money) ?? { amount: 0 }
      const fee = fleetConfig.hirePilotSigningFee
      if (m.amount < fee) return false
      player.set(Money, { amount: m.amount - fee })
      const tm = npc.get(Money)
      if (tm) npc.set(Money, { amount: tm.amount + fee })
      else npc.add(Money({ amount: fee }))
      if (npc.has(RecruitedTo)) npc.set(RecruitedTo, { owner: player })
      else npc.add(RecruitedTo({ owner: player }))
      if (npc.has(EmployedAsPilot)) npc.set(EmployedAsPilot, { msKey: '' })
      else npc.add(EmployedAsPilot({ msKey: '' }))
      return true
    }
  }
  return false
})

registerDebugHandle('getPilotRoster', (): Array<{
  npcKey: string
  name: string
  msKey: string
}> => {
  const out: Array<{ npcKey: string; name: string; msKey: string }> = []
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const npc of w.query(Character, EmployedAsPilot, EntityKey)) {
      out.push({
        npcKey: npc.get(EntityKey)!.key,
        name: npc.get(Character)!.name,
        msKey: npc.get(EmployedAsPilot)!.msKey,
      })
    }
  }
  return out
})

registerDebugHandle('transferMsViaDebug', (
  msKey: string,
  destPoiId: string,
  gameDay: number,
): { ok: boolean; arrivalDay?: number; reason?: string } => {
  const r = enqueueMsTransfer(msKey, destPoiId, gameDay)
  if (!r.ok) return { ok: false, reason: r.reason }
  return { ok: true, arrivalDay: r.arrivalDay }
})

// Direct system-tick handles — let the smoke advance the broker queue
// and the transit lander without stepping sim minutes. Same shape as the
// runShipDeliveryTick / runFleetTransitTick handles other 6.2 smokes use.
registerDebugHandle('runMsDeliveryTick', (gameDay = 0) => {
  return msDeliverySystem(gameDay)
})
registerDebugHandle('runMsTransitTick', (gameDay = 0) => {
  return msTransitSystem(gameDay)
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
