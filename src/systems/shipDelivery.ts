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
  Building, Hangar, Ship, EntityKey, Owner, ShipStatSheet, WasCaptured,
} from '../ecs/traits'
import type { ShipDeliveryRow } from '../ecs/traits'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { getShipClass } from '../data/ship-classes'
import { defaultShipName } from '../data/shipNaming'
import { attachShipStatSheet } from '../ecs/shipEffects'
import { poiIdForHangar } from '../data/pois'
import {
  fittingSlotClasses, HANGAR_SLOT_HIERARCHY, type HangarSlotClass,
} from '../data/facilityTypes'
import { getStat } from '../stats/sheet'
import { findHangarAtPoi } from './hangarQuery'
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

// Count occupied slots of each `HangarSlotClass` at the hangar's POI.
//
// Derived per-call: walks docked ships in the ship-interior world and
// greedy-assigns each to the *smallest fitting* slot class in the hangar's
// inventory, cascading into larger slots only when the snug fit is full.
// A smallCraft ship in an ms slot is bookkept as ms occupancy here (not
// smallCraft) — that's what makes the hierarchy's "wasteful upgrade"
// consistent with capacity checks at the next placement.
//
// Sort order matters: larger ships are placed first so they always get
// their exact class before cascade pressure could displace them. Within a
// class, EntityKey gives a stable tiebreaker.
//
// Returns the per-class occupancy *after* the greedy walk. Ships that
// didn't fit anywhere (overflow) don't contribute to any class — they
// stay docked at the POI un-slotted; the player resolves them through the
// gate terminal. Cheap — fleet entity count stays in the dozens at 6.2
// scope.
export function deriveHangarOccupancy(poiId: string): Record<string, number> {
  const out: Record<string, number> = {}
  if (!poiId) return out
  const hangar = findHangarAtPoi(poiId)
  const slotCapacity = hangar?.get(Hangar)?.slotCapacity ?? {}
  const shipWorld = getWorld(SHIP_SCENE_ID)
  const dockedShips: { shipClass: HangarSlotClass; key: string }[] = []
  for (const ent of shipWorld.query(Ship)) {
    const s = ent.get(Ship)!
    if (s.dockedAtPoiId !== poiId) continue
    // Ships stored inside a carrier's internal bay don't occupy a POI
    // hangar slot — they're tracked via storedAboardShipKey instead.
    if (s.storedAboardShipKey) continue
    const cls = getShipClass(s.templateId)
    dockedShips.push({
      shipClass: cls.hangarSlotClass,
      key: ent.get(EntityKey)?.key ?? '',
    })
  }
  // Sort by class rank ascending (largest-first = index 0); EntityKey
  // breaks ties so the assignment is deterministic across save/load.
  const rank = (c: HangarSlotClass): number => HANGAR_SLOT_HIERARCHY.indexOf(c)
  dockedShips.sort((a, b) => {
    const dr = rank(a.shipClass) - rank(b.shipClass)
    if (dr !== 0) return dr
    return a.key.localeCompare(b.key)
  })
  for (const s of dockedShips) {
    // Snuggest fit first: walk fitting classes from smallest to largest.
    const fitting = fittingSlotClasses(slotCapacity, s.shipClass).slice().reverse()
    for (const slotClass of fitting) {
      const cap = slotCapacity[slotClass] ?? 0
      const occ = out[slotClass] ?? 0
      if (occ < cap) {
        out[slotClass] = occ + 1
        break
      }
    }
    // No fitting slot: ship is overflow (un-slotted at POI). Don't bump out.
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
      name: defaultShipName(cls),
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
    Owner({ kind: 'character', entity: null }),
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
  const bld = hangarEnt.get(Building)
  const poiId = bld ? poiIdForHangar(sceneId, bld) : null
  if (!poiId) return { ok: false, reason: 'no_poi' }
  const cls = getShipClass(row.shipClassId)
  // Slot hierarchy: accept the smallest free slot at or above the ship's
  // class. Wasteful when the only free slot is larger; that's the player's
  // choice when they ordered the hull here.
  const occMap = deriveHangarOccupancy(poiId)
  const fitting = fittingSlotClasses(h.slotCapacity, cls.hangarSlotClass).slice().reverse()
  const hasPoiFit = fitting.some((c) => (occMap[c] ?? 0) < (h.slotCapacity[c] ?? 0))
  // Phase 6.2.5 — cascade to internal carrier bays if no POI slot is free.
  const carrierEnt = !hasPoiFit ? findCarrierSlotForShip(cls.hangarSlotClass, poiId) : null
  if (!hasPoiFit && !carrierEnt) return { ok: false, reason: 'no_slot' }
  const spawned = spawnDeliveredShip(row.shipClassId, poiId)
  if (!spawned) return { ok: false, reason: 'no_slot' }
  if (!hasPoiFit && carrierEnt) {
    assignShipToCarrierBay(spawned.entity, carrierEnt)
  }
  const next = h.pendingDeliveries.filter((_, i) => i !== rowIndex)
  hangarEnt.set(Hangar, { ...h, pendingDeliveries: next })
  return { ok: true, entityKey: spawned.entityKey }
}

// ── Phase 6.2.5 — MS-aboard carrier helpers ──────────────────────────────
//
// Carrier ships expose an internal MS bay via the `hangarCapacity` stat on
// their ShipStatSheet. Ships of class `ms` or `smallCraft` can be stored
// there instead of consuming a POI hangar slot. storedAboardShipKey on the
// stored ship links it to the carrier; deriveHangarOccupancy skips it.
// Cascade on arrival: POI slot → carrier bay → overflow (un-slotted at POI).

// Count how many ships are currently stored inside the given carrier.
export function countShipsAboard(carrierKey: string): number {
  if (!carrierKey) return 0
  const w = getWorld(SHIP_SCENE_ID)
  let count = 0
  for (const ent of w.query(Ship)) {
    if (ent.get(Ship)!.storedAboardShipKey === carrierKey) count++
  }
  return count
}

// Check whether a POI has a free slot for the given ship class (used by the
// cascade to decide whether to fall through to carrier bays).
export function hasFreePoiSlotForShip(shipClass: HangarSlotClass, poiId: string): boolean {
  const hangar = findHangarAtPoi(poiId)
  if (!hangar) return false
  const h = hangar.get(Hangar)
  if (!h) return false
  const occMap = deriveHangarOccupancy(poiId)
  const fitting = fittingSlotClasses(h.slotCapacity, shipClass).slice().reverse()
  return fitting.some((c) => (occMap[c] ?? 0) < (h.slotCapacity[c] ?? 0))
}

// Find the first carrier ship at `poiId` whose internal bay has room for
// a ship of `shipClass`. Carrier bays accept `ms` and `smallCraft` class
// ships only (mirrors the `ms` POI slot hierarchy: ms ⊇ smallCraft).
// `excludeShipKey` lets the caller skip itself (e.g. the arriving ship).
export function findCarrierSlotForShip(
  shipClass: HangarSlotClass,
  poiId: string,
  excludeShipKey = '',
): Entity | null {
  // Only ms-class and smaller ships fit in carrier internal bays.
  const msRank = HANGAR_SLOT_HIERARCHY.indexOf('ms' as HangarSlotClass)
  const shipRank = HANGAR_SLOT_HIERARCHY.indexOf(shipClass)
  if (shipRank < msRank) return null
  const w = getWorld(SHIP_SCENE_ID)
  for (const ent of w.query(Ship, ShipStatSheet, EntityKey)) {
    const s = ent.get(Ship)!
    if (s.dockedAtPoiId !== poiId) continue
    if (s.transitDestinationId) continue
    const carrierKey = ent.get(EntityKey)!.key
    if (carrierKey === excludeShipKey) continue
    const sheet = ent.get(ShipStatSheet)!.sheet
    const cap = Math.floor(getStat(sheet, 'hangarCapacity'))
    if (cap <= 0) continue
    if (countShipsAboard(carrierKey) < cap) return ent
  }
  return null
}

// Store a ship inside a carrier's internal bay. Sets storedAboardShipKey on
// the stored ship; the carrier's hangar capacity is consumed implicitly via
// countShipsAboard reads. No-op when either entity is missing Ship.
export function assignShipToCarrierBay(shipEnt: Entity, carrierEnt: Entity): void {
  const s = shipEnt.get(Ship)
  if (!s) return
  const carrierKey = carrierEnt.get(EntityKey)?.key ?? ''
  if (!carrierKey) return
  shipEnt.set(Ship, { ...s, storedAboardShipKey: carrierKey })
}

// Release all ships stored aboard `carrierKey` back to POI overflow.
// Each released ship keeps its dockedAtPoiId (the carrier's port) and
// becomes un-slotted there. Called when a carrier enters transit or undocks.
export function releaseShipsFromCarrier(carrierKey: string): void {
  if (!carrierKey) return
  const w = getWorld(SHIP_SCENE_ID)
  for (const ent of w.query(Ship)) {
    const s = ent.get(Ship)!
    if (s.storedAboardShipKey !== carrierKey) continue
    ent.set(Ship, { ...s, storedAboardShipKey: '' })
  }
}

// Issue #71 — on the flagship's next dock, route every captured in-flight
// hull (WasCaptured + homeHangarId empty) to a delivery queue at the
// docked POI, exactly like a fresh purchase. The in-flight Ship entity is
// despawned and replaced by a delivery row (lead time 0 — it's already
// here, just needs a slot); the player receives it via the hangar manager
// like any bought hull. No hangar / capacity at the POI → the hull stays
// in-flight (the broker-side "find a slot" prompt is the player's problem,
// same as a purchase with no slot). Returns the count queued.
export function routeCapturedHullsToDelivery(destPoiId: string, gameDay: number): number {
  if (!destPoiId) return 0
  const hangar = findHangarAtPoi(destPoiId)
  if (!hangar) return 0
  const shipWorld = getWorld(SHIP_SCENE_ID)
  let queued = 0
  for (const ent of [...shipWorld.query(Ship, WasCaptured)]) {
    const s = ent.get(Ship)!
    if (s.homeHangarId) continue   // already housed; not in the in-flight state
    const enq = enqueueDelivery(hangar, s.templateId, gameDay, 0)
    if (!enq) continue
    ent.destroy()
    queued += 1
  }
  return queued
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
