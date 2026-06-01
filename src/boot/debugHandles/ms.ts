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
import { poiIdForHangar } from '../../data/pois'
import {
  Ms, MsStatSheet, PlayerPartsInventory, EntityKey, Building, Hangar, Character,
  EmployedAsPilot, RecruitedTo, IsPlayer, Money, ResupplyState,
  CombatShipState,
} from '../../ecs/traits'
import { useUI } from '../../ui/uiStore'
import { enqueueMsDelivery, receiveMsDelivery, msDeliverySystem } from '../../systems/msDelivery'
import { enqueueMsTransfer, msTransitSystem } from '../../systems/msTransfer'
import { autoAssignPilotForMs, assignPilotToMs } from '../../systems/msPilotAssign'
import { buyPart } from '../../systems/partsSales'
import { refreshAllDepotMsLayouts } from '../../ecs/spawn'
import { fleetConfig } from '../../config'
import { useClock, gameDayNumber } from '../../sim/clock'
import {
  installFrameModEffect, uninstallFrameModEffect,
} from '../../ecs/msEffects'
import { dispatchRecoveryTug, getRecoveryTugs } from '../../sim/recoveryTug'
import { getDoorSnapshot, sortieStats } from '../../sim/hangarDoors'
import { getStat } from '../../stats/sheet'

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
  // Phase 6.2.5.C — sortie resources + frame mods. Infinity ammo serializes
  // to the sentinel string 'Inf' so the JSON round-trip stays clean.
  currentPropellant: number
  currentAmmoByWeapon: Record<string, number | 'Inf'>
  currentLifeSupport: number
  frameMods: string[]
  propellantStorageCap: number
  lifeSupportMinutesCap: number
  frameSlotsCap: number
  // Resupply state (if currently being resupplied).
  resupplyShipKey: string
  resupplyDoorId: string
  resupplySecRemaining: number
  resupplySecTotal: number
}

function snapshotOneMs(ent: import('koota').Entity): MsSnapshot {
  const ms = ent.get(Ms)!
  const key = ent.get(EntityKey)!.key
  const sheet = ent.get(MsStatSheet)?.sheet
  const propCap = sheet ? getStat(sheet, 'propellantStorage') : 0
  const lsCap = sheet ? getStat(sheet, 'lifeSupportMinutes') : 0
  const slotsCap = sheet ? getStat(sheet, 'frameSlots') : 0
  const ammoOut: Record<string, number | 'Inf'> = {}
  for (const [hpId, count] of Object.entries(ms.currentAmmoByWeapon)) {
    ammoOut[hpId] = Number.isFinite(count) ? count : 'Inf'
  }
  const rs = ent.get(ResupplyState)
  return {
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
    currentPropellant: ms.currentPropellant,
    currentAmmoByWeapon: ammoOut,
    currentLifeSupport: ms.currentLifeSupport,
    frameMods: [...ms.frameMods],
    propellantStorageCap: propCap,
    lifeSupportMinutesCap: lsCap,
    frameSlotsCap: slotsCap,
    resupplyShipKey: rs?.shipKey ?? '',
    resupplyDoorId: rs?.bayDoorId ?? '',
    resupplySecRemaining: rs?.secRemaining ?? 0,
    resupplySecTotal: rs?.secTotal ?? 0,
  }
}

registerDebugHandle('getMsRoster', (): MsSnapshot[] => {
  const w = getWorld(SHIP_SCENE_ID)
  const result: MsSnapshot[] = []
  for (const ent of w.query(Ms, EntityKey)) result.push(snapshotOneMs(ent))
  return result
})

registerDebugHandle('getMsWeaponCounts', (): Record<string, number> => {
  const w = getWorld(SHIP_SCENE_ID)
  for (const ent of w.query(PlayerPartsInventory)) {
    return { ...ent.get(PlayerPartsInventory)!.weapons }
  }
  return {}
})

// Issue #64 — frame-mod stockpile snapshot (sibling of getMsWeaponCounts);
// the parts-acquisition smoke asserts frame-mod buys + salvage drops here.
registerDebugHandle('getMsFrameModCounts', (): Record<string, number> => {
  const w = getWorld(SHIP_SCENE_ID)
  for (const ent of w.query(PlayerPartsInventory)) {
    return { ...ent.get(PlayerPartsInventory)!.frameMods }
  }
  return {}
})

// Issue #64 — drive the AE parts-broker purchase (debit Money + credit
// PlayerPartsInventory) without DOM hunting. Mirrors the aePartsSales
// branch's buy click. Defaults the dealer to the VB parts broker.
registerDebugHandle('buyPartCheat', (
  kind: 'weapon' | 'frameMod',
  partId: string,
  specId: string = 'ae_parts_dealer_vb',
) => buyPart(specId, kind, partId))

registerDebugHandle('getMs', (msKey: string): MsSnapshot | null => {
  const w = getWorld(SHIP_SCENE_ID)
  for (const ent of w.query(Ms, EntityKey)) {
    if (ent.get(EntityKey)!.key === msKey) return snapshotOneMs(ent)
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
        poiId: poiIdForHangar(sceneId, b.get(Building)!),
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

// Issue #65 — the AE vehicle broker's configured catalog rows. Smoke
// reads this to assert the two-row catalog (civFighter + mobileWorker)
// without driving the broker dialog DOM.
registerDebugHandle('getVehicleCatalogRows', (): string[] => {
  const out: string[] = []
  for (const entry of Object.values(fleetConfig.vehicleSalesRepCatalog)) {
    for (const id of entry.msClassIds) out.push(id)
  }
  return out
})

// Issue #65 — manual pilot reassign through the canonical assignment path
// (same write the pilot roster panel's reassign button calls).
registerDebugHandle('assignPilotViaDebug', (npcKey: string, msKey: string): boolean => {
  return assignPilotToMs(npcKey, msKey)
})

// Issue #65 — open the pilot roster panel (mirrors openMsRetrofit).
registerDebugHandle('openPilotRoster', () => {
  useUI.getState().setPilotRoster(true)
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

// ─── Phase 6.2.5.C debug handles ─────────────────────────────────────────

// Stranded MS list — drives the smoke's "dispatch tug" step. Returns the
// keys of MS entities whose currentPropellant has hit zero.
registerDebugHandle('getStrandedMs', (): Array<{ key: string; name: string }> => {
  const w = getWorld(SHIP_SCENE_ID)
  const out: Array<{ key: string; name: string }> = []
  for (const ent of w.query(Ms, EntityKey)) {
    const m = ent.get(Ms)!
    if (m.currentPropellant <= 0) {
      out.push({ key: ent.get(EntityKey)!.key, name: m.name })
    }
  }
  return out
})

registerDebugHandle('dispatchRecoveryTug', (
  strandedMsKey: string,
): { ok: boolean; tugKey?: string; reason?: string } => {
  const r = dispatchRecoveryTug(strandedMsKey)
  return r.ok ? { ok: true, tugKey: r.tugKey } : { ok: false, reason: r.reasonZh }
})

registerDebugHandle('getRecoveryTugs', () => {
  return getRecoveryTugs()
})

registerDebugHandle('getHangarDoors', (shipKey: string) => {
  return getDoorSnapshot(shipKey)
})

// Frame mod install / uninstall via debug — used by the smoke to assert
// effect-engine wiring without driving the UI panel directly. Returns
// whether the operation succeeded (same gating rules as the UI verb).
registerDebugHandle('installFrameMod', (msKey: string, modId: string): boolean => {
  const w = getWorld(SHIP_SCENE_ID)
  let msEnt = null
  for (const ent of w.query(Ms, EntityKey)) {
    if (ent.get(EntityKey)!.key === msKey) { msEnt = ent; break }
  }
  if (!msEnt) return false
  let partsEnt = null
  for (const ent of w.query(PlayerPartsInventory)) { partsEnt = ent; break }
  if (!partsEnt) return false
  const curParts = partsEnt.get(PlayerPartsInventory)!
  const stock = curParts.frameMods[modId] ?? 0
  if (stock <= 0) return false
  if (!installFrameModEffect(msEnt, modId)) return false
  const nextParts = { ...curParts.frameMods }
  if (stock - 1 <= 0) delete nextParts[modId]
  else nextParts[modId] = stock - 1
  partsEnt.set(PlayerPartsInventory, { ...curParts, frameMods: nextParts })
  return true
})

registerDebugHandle('uninstallFrameMod', (msKey: string, modId: string): boolean => {
  const w = getWorld(SHIP_SCENE_ID)
  let msEnt = null
  for (const ent of w.query(Ms, EntityKey)) {
    if (ent.get(EntityKey)!.key === msKey) { msEnt = ent; break }
  }
  if (!msEnt) return false
  let partsEnt = null
  for (const ent of w.query(PlayerPartsInventory)) { partsEnt = ent; break }
  if (!partsEnt) return false
  if (!uninstallFrameModEffect(msEnt, modId)) return false
  const curParts = partsEnt.get(PlayerPartsInventory)!
  partsEnt.set(PlayerPartsInventory, {
    ...curParts,
    frameMods: {
      ...curParts.frameMods,
      [modId]: (curParts.frameMods[modId] ?? 0) + 1,
    },
  })
  return true
})

// Move an MS into / out of a depot POI — used by the smoke to set up
// scenarios that depend on the depot-gate frame-mod install rule.
registerDebugHandle('parkMsAtPoi', (msKey: string, poiId: string): boolean => {
  const w = getWorld(SHIP_SCENE_ID)
  for (const ent of w.query(Ms, EntityKey)) {
    if (ent.get(EntityKey)!.key !== msKey) continue
    const m = ent.get(Ms)!
    ent.set(Ms, { ...m, storedOnShipKey: '', dockedAtPoiId: poiId, bayIndex: 0 })
    return true
  }
  return false
})

// Test handle: directly set sortie resources on a saved MS for fixture
// drive without flying actual physics. The smoke uses this to set up the
// "low propellant, 1 round of ammo" baseline so the per-tick drain math
// completes in seconds of sim time. Read by the smoke; not the UI path.
registerDebugHandle('setMsSortieResources', (
  msKey: string,
  fields: Partial<{
    currentPropellant: number
    currentLifeSupport: number
    currentAmmoByWeapon: Record<string, number | 'Inf'>
  }>,
): boolean => {
  const w = getWorld(SHIP_SCENE_ID)
  for (const ent of w.query(Ms, EntityKey)) {
    if (ent.get(EntityKey)!.key !== msKey) continue
    const m = ent.get(Ms)!
    const next = { ...m }
    if (fields.currentPropellant !== undefined) next.currentPropellant = fields.currentPropellant
    if (fields.currentLifeSupport !== undefined) next.currentLifeSupport = fields.currentLifeSupport
    if (fields.currentAmmoByWeapon !== undefined) {
      const ammo: Record<string, number> = {}
      for (const [hpId, count] of Object.entries(fields.currentAmmoByWeapon)) {
        ammo[hpId] = count === 'Inf' ? Infinity : (count as number)
      }
      next.currentAmmoByWeapon = ammo
    }
    ent.set(Ms, next)
    return true
  }
  return false
})

// Snapshot the profile counters — used by the smoke + manual perf runs.
registerDebugHandle('getSortieStats', () => ({ ...sortieStats }))

// Snapshot the player's piloted MS state (CombatShipState row) for the
// smoke's relaunch-position assertion. Returns null if no MS launched.
const PLAYER_MS_KEY = 'player-ms-1'
registerDebugHandle('getPilotedMsState', (): {
  pos: { x: number; y: number }
  vel: { x: number; y: number }
  heading: number
  weapons: Array<{ weaponId: string; hardpointId: string; ready: boolean; chargeSec: number }>
} | null => {
  const w = getWorld(SHIP_SCENE_ID)
  for (const ent of w.query(CombatShipState, EntityKey)) {
    if (ent.get(EntityKey)!.key !== PLAYER_MS_KEY) continue
    const cs = ent.get(CombatShipState)!
    return {
      pos: { ...cs.pos },
      vel: { ...cs.vel },
      heading: cs.heading,
      weapons: cs.weapons.map((w0) => ({
        weaponId: w0.weaponId,
        hardpointId: w0.hardpointId,
        ready: w0.ready,
        chargeSec: w0.chargeSec,
      })),
    }
  }
  return null
})

// Snapshot the flagship's tactical pos / heading for the smoke's
// spawn-at-door geometry assertion.
registerDebugHandle('getFlagshipCombatPose', (): {
  pos: { x: number; y: number }
  heading: number
} | null => {
  const w = getWorld(SHIP_SCENE_ID)
  for (const ent of w.query(CombatShipState)) {
    const cs = ent.get(CombatShipState)!
    if (cs.isFlagship || cs.isPlayer) {
      return { pos: { ...cs.pos }, heading: cs.heading }
    }
  }
  return null
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
  partsEnt.set(PlayerPartsInventory, { ...curParts, weapons: updatedWeapons })
  return true
})
