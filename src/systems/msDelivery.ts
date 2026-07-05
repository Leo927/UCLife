// Phase 6.2.5.B MS delivery system. Mirrors `shipDelivery.ts` but for MS
// entities purchased at the AE vehicle broker. Runs on
// `day:rollover:settled`; for each Hangar with pendingMsDeliveries,
// flip in-transit rows whose arrivalDay has been reached to 'arrived'.
// Receive-MS-delivery (entity spawn) is the player's click on the manager
// dialog — never automatic — so multiple arrived rows can stack.
//
// Spawning an MS at receive-delivery time materializes a new Ms entity in
// `playerShipInterior` with `dockedAtPoiId = <hangar's POI>` (instead of
// `storedOnShipKey`), and triggers the auto-assign-pilot pass + the
// depot MS layout refresh so the sprite + terminal appear in the depot
// scene the player is standing in.

import type { Entity } from 'koota'
import {
  Building, Hangar, Ms, MsStatSheet, EntityKey,
  type MsDeliveryRow,
} from '../ecs/traits'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { getMsClass, defaultMountedWeapons } from '../data/ms'
import { attachMsStatSheet } from '../ecs/msEffects'
import { poiIdForHangar } from '../data/pois'
import { fittingSlotClasses } from '../data/facilityTypes'
import { deriveHangarOccupancy } from './shipDelivery'

const SHIP_SCENE_ID = 'playerShipInterior' as const

export interface MsDeliveryResult {
  hangarsTicked: number
  rowsArrived: number
}

export function msDeliverySystem(gameDay: number): MsDeliveryResult {
  const result: MsDeliveryResult = { hangarsTicked: 0, rowsArrived: 0 }
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const ent of w.query(Building, Hangar)) {
      const h = ent.get(Hangar)!
      if (h.pendingMsDeliveries.length === 0) continue
      let mutated = false
      const next = h.pendingMsDeliveries.map((row) => {
        if (row.status === 'in_transit' && gameDay >= row.arrivalDay) {
          mutated = true
          result.rowsArrived += 1
          return { ...row, status: 'arrived' as const }
        }
        return row
      })
      if (mutated) {
        result.hangarsTicked += 1
        ent.set(Hangar, { ...h, pendingMsDeliveries: next })
      }
    }
  }
  return result
}

// Spawn an MS entity at the given hangar's POI. Mirrors the starter-MS
// grant shape minus the storedOnShipKey link — depot-housed MS sit at the
// POI directly via `dockedAtPoiId`.
function spawnDeliveredMs(msClassId: string, poiId: string): { entity: Entity; entityKey: string } {
  const cls = getMsClass(msClassId)
  const shipWorld = getWorld(SHIP_SCENE_ID)
  const key = nextDeliveredMsKey(msClassId)
  const ent = shipWorld.spawn(
    Ms({
      templateId: cls.id,
      name: cls.nameZh,
      hullCurrent: cls.hullMax,
      hullMax: cls.hullMax,
      armorCurrent: cls.armorMax,
      armorMax: cls.armorMax,
      mountedWeapons: defaultMountedWeapons(cls),
      storedOnShipKey: '',
      bayIndex: 0,
      dockedAtPoiId: poiId,
      pilotId: '',
      transitDestinationId: '',
      transitArrivalDay: 0,
      // Phase 6.2.5.C — attachMsStatSheet seeds caps when these are 0.
      currentPropellant: 0,
      currentAmmoByWeapon: {},
      currentLifeSupport: 0,
      frameMods: [],
      // A freshly-delivered hull is always undamaged.
      damageState: 'ready',
    }),
    EntityKey({ key }),
  )
  attachMsStatSheet(ent)
  return { entity: ent, entityKey: key }
}

const deliveredMsCounters: Record<string, number> = {}
function nextDeliveredMsKey(msClassId: string): string {
  const n = deliveredMsCounters[msClassId] ?? 0
  deliveredMsCounters[msClassId] = n + 1
  return `ms-delivered-${msClassId}-${n}`
}

export function resetDeliveredMsCounter(): void {
  for (const k of Object.keys(deliveredMsCounters)) delete deliveredMsCounters[k]
}

// Receive-MS-delivery click handler. Spawns the Ms entity at the hangar's
// POI and pops the row. Gate on (1) row exists, (2) row arrived, (3) the
// hangar advertises an MS slot (ms ⊇ smallCraft per the slot hierarchy) at
// the POI. No auto-assign here — caller does it after the entity ref is
// known so the auto-assign system can read MsStatSheet without races.
export function receiveMsDelivery(
  hangarEnt: Entity,
  sceneId: string,
  rowIndex: number,
): { ok: true; entityKey: string; msClassId: string } | { ok: false; reason: 'no_row' | 'not_arrived' | 'no_poi' | 'no_ms_slot' } {
  const h = hangarEnt.get(Hangar)
  if (!h) return { ok: false, reason: 'no_row' }
  const row = h.pendingMsDeliveries[rowIndex]
  if (!row) return { ok: false, reason: 'no_row' }
  if (row.status !== 'arrived') return { ok: false, reason: 'not_arrived' }
  const bld = hangarEnt.get(Building)
  const poiId = bld ? poiIdForHangar(sceneId, bld) : null
  if (!poiId) return { ok: false, reason: 'no_poi' }
  // Hangar must advertise at least one MS-fitting slot class. The MS
  // hierarchy entry is 'ms'; deriveHangarOccupancy is not consulted here
  // because depot MS occupancy doesn't consume a ship-slot — but the
  // *hangar capability* gate still applies: a hangar with no 'ms' or
  // 'capital' slots shouldn't receive MS deliveries.
  const fitting = fittingSlotClasses(h.slotCapacity, 'ms')
  if (fitting.length === 0) return { ok: false, reason: 'no_ms_slot' }
  // (Occupancy is read for parity / future per-slot quotas; not gating today.)
  void deriveHangarOccupancy(poiId)
  const spawned = spawnDeliveredMs(row.msClassId, poiId)
  const next = h.pendingMsDeliveries.filter((_, i) => i !== rowIndex)
  hangarEnt.set(Hangar, { ...h, pendingMsDeliveries: next })
  // Touch MsStatSheet to silence the unused-import lint for callers that
  // import the same types; the spawn above already attaches it.
  void MsStatSheet
  return { ok: true, entityKey: spawned.entityKey, msClassId: row.msClassId }
}

// Buy-vehicle action: enqueue a delivery row on the target hangar. The
// AE vehicle broker dialog calls this once gating has passed.
export function enqueueMsDelivery(
  hangarEnt: Entity,
  msClassId: string,
  orderDay: number,
  leadTimeDays: number,
): { rowIndex: number } | null {
  const h = hangarEnt.get(Hangar)
  if (!h) return null
  const row: MsDeliveryRow = {
    msClassId,
    orderDay,
    arrivalDay: orderDay + leadTimeDays,
    status: 'in_transit',
  }
  const next = [...h.pendingMsDeliveries, row]
  hangarEnt.set(Hangar, { ...h, pendingMsDeliveries: next })
  return { rowIndex: next.length - 1 }
}
