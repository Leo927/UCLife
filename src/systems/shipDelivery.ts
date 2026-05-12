// Phase 6.2.C1 ship delivery system. Runs once per game day from the
// `day:rollover:settled` chain in src/sim/loop.ts. For each Hangar with
// pendingDeliveries, flip in-transit rows whose arrivalDay has been
// reached to 'arrived'. Receive-delivery (entity spawn) is the player's
// click on the manager dialog — never automatic — so the queue can
// surface multiple arrived rows without the loop racing the UI.
//
// Scope: the queue is per-hangar. A buy at the AE VB sales rep targets
// one specific hangar (the player picks); the row sits on that hangar
// trait until received. Cross-hangar transit is a 6.2.G concern.

import type { Entity } from 'koota'
import {
  Building, Hangar, Ship, EntityKey,
} from '../ecs/traits'
import type { ShipDeliveryRow } from '../ecs/traits'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { getShipClass } from '../data/ship-classes'
import { attachShipStatSheet } from '../ecs/shipEffects'
import { POIS } from '../data/pois'
import { fleetConfig } from '../config'

export interface ShipDeliveryResult {
  hangarsTicked: number
  rowsArrived: number
}

export function shipDeliverySystem(gameDay: number): ShipDeliveryResult {
  const result: ShipDeliveryResult = { hangarsTicked: 0, rowsArrived: 0 }
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const ent of w.query(Building, Hangar)) {
      const h = ent.get(Hangar)!
      if (h.pendingDeliveries.length === 0) continue
      let mutated = false
      const next = h.pendingDeliveries.map((row) => {
        if (row.status === 'in_transit' && gameDay >= row.arrivalDay) {
          mutated = true
          result.rowsArrived += 1
          return { ...row, status: 'arrived' as const }
        }
        return row
      })
      if (mutated) {
        result.hangarsTicked += 1
        ent.set(Hangar, { ...h, pendingDeliveries: next })
      }
    }
  }
  return result
}

const SHIP_SCENE_ID = 'playerShipInterior' as const

// POI id for a hangar's host scene. Scene → POI is N:1 today (vonBraunCity
// ↔ vonBraun, granadaDrydock ↔ granada). Returns null if no POI is bound
// to the scene — caller should refuse delivery in that case.
export function poiIdForHangarScene(sceneId: string): string | null {
  for (const poi of POIS) {
    if (poi.sceneId === sceneId) return poi.id
  }
  return null
}

// Count occupied slots of each `HangarSlotClass` at the hangar's POI.
// Derived: walk ships in the ship-interior world, bucket by their class's
// hangarSlotClass when dockedAtPoiId matches. Cheap — fleet entity count
// stays in the dozens even at full 6.2 scope.
export function deriveHangarOccupancy(poiId: string): Record<string, number> {
  const out: Record<string, number> = {}
  if (!poiId) return out
  const shipWorld = getWorld(SHIP_SCENE_ID)
  for (const ent of shipWorld.query(Ship)) {
    const s = ent.get(Ship)!
    if (s.dockedAtPoiId !== poiId) continue
    const cls = getShipClass(s.templateId)
    const cls_slot = cls.hangarSlotClass
    out[cls_slot] = (out[cls_slot] ?? 0) + 1
  }
  return out
}

// Spawn a delivered ship entity at the given hangar's POI. Mirrors the
// flagship's bootstrap shape (Ship + ShipStatSheet + ShipEffectsList +
// EntityKey) minus IsFlagshipMark. Ships live in `playerShipInterior`
// alongside the flagship; the walkable-interior layout for non-flagship
// hulls is a 6.3+ concern (per Design/fleet.md "switching is routine
// transit" — the second hull's interior gets bootstrapped only when
// the player physically boards it).
export function spawnDeliveredShip(
  shipClassId: string,
  poiId: string,
): { entity: Entity; entityKey: string } | null {
  const cls = getShipClass(shipClassId)
  const shipWorld = getWorld(SHIP_SCENE_ID)
  const key = nextDeliveredShipKey(shipClassId)
  const ent = shipWorld.spawn(
    Ship({
      templateId: cls.id,
      hullCurrent: cls.hullMax, hullMax: cls.hullMax,
      armorCurrent: cls.armorMax, armorMax: cls.armorMax,
      fluxMax: cls.fluxMax, fluxCurrent: 0,
      fluxDissipation: cls.fluxDissipation,
      hasShield: cls.hasShield,
      shieldEfficiency: cls.shieldEfficiency,
      topSpeed: cls.topSpeed,
      accel: cls.accel,
      decel: cls.decel,
      angularAccel: cls.angularAccel,
      maxAngVel: cls.maxAngVel,
      crCurrent: cls.crMax, crMax: cls.crMax,
      fuelCurrent: cls.fuelMax, fuelMax: cls.fuelMax,
      suppliesCurrent: cls.suppliesMax, suppliesMax: cls.suppliesMax,
      dockedAtPoiId: poiId,
      fleetPos: { x: 0, y: 0 },
      inCombat: false,
      // Phase 6.2.E1 — newly-delivered ships default to reserve (no
      // IsInActiveFleet marker, no formationSlot) so the player opts
      // each subsequent hull into the active fleet from the war-room
      // plot table. Aggression starts at the configured default.
      aggression: fleetConfig.aggressionDefault,
      formationSlot: -1,
    }),
    EntityKey({ key }),
  )
  attachShipStatSheet(ent)
  return { entity: ent, entityKey: key }
}

const deliveredCounters: Record<string, number> = {}
function nextDeliveredShipKey(shipClassId: string): string {
  const n = deliveredCounters[shipClassId] ?? 0
  deliveredCounters[shipClassId] = n + 1
  return `ship-delivered-${shipClassId}-${n}`
}

// Reset path. Called once at world-reset (saveHandler) so the counter
// suffix doesn't grow across reseeds within the same dev session.
export function resetDeliveredShipCounter(): void {
  for (const k of Object.keys(deliveredCounters)) delete deliveredCounters[k]
}

// Receive-delivery click handler. Returns the spawned entity key, or
// an error string when the click can't proceed (capacity, no row, etc.).
// Pure ECS surface — no UI, no toast — so the UI branch can wrap the
// reply in a localized message.
export function receiveDelivery(
  hangarEnt: Entity,
  sceneId: string,
  rowIndex: number,
): { ok: true; entityKey: string } | { ok: false; reason: 'no_row' | 'not_arrived' | 'no_slot' | 'no_poi' } {
  const h = hangarEnt.get(Hangar)
  if (!h) return { ok: false, reason: 'no_row' }
  const row = h.pendingDeliveries[rowIndex]
  if (!row) return { ok: false, reason: 'no_row' }
  if (row.status !== 'arrived') return { ok: false, reason: 'not_arrived' }
  const poiId = poiIdForHangarScene(sceneId)
  if (!poiId) return { ok: false, reason: 'no_poi' }
  const cls = getShipClass(row.shipClassId)
  const cap = h.slotCapacity[cls.hangarSlotClass] ?? 0
  const occ = deriveHangarOccupancy(poiId)[cls.hangarSlotClass] ?? 0
  if (occ >= cap) return { ok: false, reason: 'no_slot' }
  const spawned = spawnDeliveredShip(row.shipClassId, poiId)
  if (!spawned) return { ok: false, reason: 'no_slot' }
  const next = h.pendingDeliveries.filter((_, i) => i !== rowIndex)
  hangarEnt.set(Hangar, { ...h, pendingDeliveries: next })
  return { ok: true, entityKey: spawned.entityKey }
}

// Buy-ship action: enqueue a delivery row on the target hangar. The
// AE sales-rep dialog calls this once gating has passed (money + slot
// availability). Returns the new row index for the caller's debug
// trace, or null when the row could not be appended (e.g. hangar
// missing on the entity).
export function enqueueDelivery(
  hangarEnt: Entity,
  shipClassId: string,
  orderDay: number,
  leadTimeDays: number,
): { rowIndex: number } | null {
  const h = hangarEnt.get(Hangar)
  if (!h) return null
  const row: ShipDeliveryRow = {
    shipClassId,
    orderDay,
    arrivalDay: orderDay + leadTimeDays,
    status: 'in_transit',
  }
  const next = [...h.pendingDeliveries, row]
  hangarEnt.set(Hangar, { ...h, pendingDeliveries: next })
  return { rowIndex: next.length - 1 }
}
