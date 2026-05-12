// Phase 6.2.A hangar debug handles. Lets the smoke suite locate the
// state-rental hangar, inspect its facility shape (tier, slotCapacity),
// and resolve the manager NPC entity for the talk-verb assertion.
//
// Phase 6.2.B extends with: damageFlagship, setHangarRepairPriority,
// runHangarRepairTick — the deterministic drivers the smoke uses to
// exercise persistent damage + repair throughput without leaning on
// real-time loop scheduling.
//
// Phase 6.2.C1 extends with: deliverySnapshot, enqueueShipDelivery,
// runShipDeliveryTick, receiveShipDelivery, listShipsInFleet — the
// deterministic drivers the smoke uses to exercise the AE buy →
// hangar manager receive flow.
//
// Phase 6.2.F extends with: hangarSupplySnapshot, setHangarSupply,
// enqueueHangarDelivery, runFleetSupplyTick, fleetSupplyTotals,
// aeSupplyDealerEntity, secretaryEntity, forceSeatSecretary — the
// deterministic drivers the smoke uses to exercise the supply / fuel
// economy.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { world, getWorld, SCENE_IDS } from '../../ecs/world'
import {
  Action, Building, Character, EntityKey, Hangar, Job, Owner, Position, Workstation, Ship,
  IsFlagshipMark, ShipStatSheet,
  type HangarSlotClass, type HangarTier, type ShipDeliveryRow, type SupplyKind,
} from '../../ecs/traits'
import { worldConfig } from '../../config'
import { hangarRepairSystem, describeHangarRepair } from '../../systems/hangarRepair'
import {
  fleetSupplyDrainSystem, aggregateHangarReserves,
} from '../../systems/fleetSupplyDrain'
import {
  fleetSupplyDeliverySystem, enqueueSupplyDelivery,
} from '../../systems/fleetSupplyDelivery'
import {
  shipDeliverySystem, enqueueDelivery, receiveDelivery,
  poiIdForHangarScene, deriveHangarOccupancy,
} from '../../systems/shipDelivery'
import { getStat } from '../../stats/sheet'
import { getShipClass } from '../../data/ship-classes'
import { spawnNPC } from '../../character/spawn'
import { pickFreshName, pickRandomColor } from '../../character/nameGen'

const TILE = worldConfig.tilePx

interface HangarSnapshot {
  buildingKey: string
  typeId: string
  ownerKind: 'state' | 'faction' | 'character'
  tier: HangarTier
  slotCapacity: Partial<Record<HangarSlotClass, number>>
  rectTile: { x: number; y: number; w: number; h: number }
  manager: {
    specId: string
    occupantName: string | null
    posTile: { x: number; y: number } | null
  } | null
  workerCount: number
  workersSeated: number
}

function buildingContains(bld: { x: number; y: number; w: number; h: number }, p: { x: number; y: number }): boolean {
  return p.x >= bld.x && p.x < bld.x + bld.w && p.y >= bld.y && p.y < bld.y + bld.h
}

function snapshotHangar(b: ReturnType<typeof world.query>[number]): HangarSnapshot {
  const bld = b.get(Building)!
  const key = b.get(EntityKey)?.key ?? ''
  const h = b.get(Hangar)!
  const o = b.get(Owner)!

  let manager: HangarSnapshot['manager'] = null
  let workerCount = 0
  let workersSeated = 0
  for (const ws of world.query(Workstation, Position)) {
    const w = ws.get(Workstation)!
    const wp = ws.get(Position)!
    if (!buildingContains(bld, wp)) continue
    if (w.specId === 'hangar_manager') {
      const occ = w.occupant
      manager = {
        specId: w.specId,
        occupantName: occ?.get(Character)?.name ?? null,
        posTile: { x: Math.round(wp.x / TILE), y: Math.round(wp.y / TILE) },
      }
    } else if (w.specId === 'hangar_worker') {
      workerCount += 1
      if (w.occupant) workersSeated += 1
    }
  }

  return {
    buildingKey: key,
    typeId: bld.typeId,
    ownerKind: o.kind,
    tier: h.tier,
    slotCapacity: h.slotCapacity,
    rectTile: {
      x: Math.round(bld.x / TILE),
      y: Math.round(bld.y / TILE),
      w: Math.round(bld.w / TILE),
      h: Math.round(bld.h / TILE),
    },
    manager,
    workerCount,
    workersSeated,
  }
}

registerDebugHandle('listHangars', (): HangarSnapshot[] => {
  const out: HangarSnapshot[] = []
  for (const b of world.query(Building, Hangar, Owner, EntityKey)) {
    out.push(snapshotHangar(b))
  }
  return out
})

// Returns the hangar manager NPC entity by buildingKey, or null if no
// occupant. Smoke tests drive setDialogNPC(manager) with this.
registerDebugHandle('hangarManagerEntity', (buildingKey: string) => {
  for (const b of world.query(Building, Hangar, EntityKey)) {
    if (b.get(EntityKey)!.key !== buildingKey) continue
    const bld = b.get(Building)!
    for (const ws of world.query(Workstation, Position)) {
      const w = ws.get(Workstation)!
      const wp = ws.get(Position)!
      if (!buildingContains(bld, wp)) continue
      if (w.specId !== 'hangar_manager') continue
      return w.occupant ?? null
    }
  }
  return null
})

// ── Phase 6.2.B helpers ──────────────────────────────────────────────────

// Apply a flat damage hit to the flagship's hull + armor. The smoke uses
// this to set up the "post-combat" state without spinning combat.
// Returns the resulting hull/armor pair.
registerDebugHandle('damageFlagship', (hullLoss: number, armorLoss: number = 0) => {
  const w = getWorld('playerShipInterior')
  const ent = w.queryFirst(Ship, IsFlagshipMark)
  if (!ent) return null
  const s = ent.get(Ship)!
  ent.set(Ship, {
    ...s,
    hullCurrent: Math.max(0, s.hullCurrent - hullLoss),
    armorCurrent: Math.max(0, s.armorCurrent - armorLoss),
  })
  const after = ent.get(Ship)!
  return {
    hullCurrent: after.hullCurrent, hullMax: after.hullMax,
    armorCurrent: after.armorCurrent, armorMax: after.armorMax,
    dockedAtPoiId: after.dockedAtPoiId,
  }
})

// Read the flagship's current hull / armor / docked POI. Smoke uses
// this between repair ticks to assert progression.
registerDebugHandle('flagshipDamage', () => {
  const w = getWorld('playerShipInterior')
  const ent = w.queryFirst(Ship, IsFlagshipMark)
  if (!ent) return null
  const s = ent.get(Ship)!
  return {
    hullCurrent: s.hullCurrent, hullMax: s.hullMax,
    armorCurrent: s.armorCurrent, armorMax: s.armorMax,
    dockedAtPoiId: s.dockedAtPoiId,
  }
})

// Read the flagship's ShipStatSheet `hullPoints` stat — confirms that
// the per-ship sheet projected the template at spawn (and survived a
// save round-trip if the smoke chooses to test it).
registerDebugHandle('flagshipStatSheet', () => {
  const w = getWorld('playerShipInterior')
  const ent = w.queryFirst(Ship, ShipStatSheet)
  if (!ent) return null
  const sheet = ent.get(ShipStatSheet)!.sheet
  return {
    hullPoints: getStat(sheet, 'hullPoints'),
    armorPoints: getStat(sheet, 'armorPoints'),
    topSpeed: getStat(sheet, 'topSpeed'),
    brigCapacity: getStat(sheet, 'brigCapacity'),
    crewRequired: getStat(sheet, 'crewRequired'),
    fuelStorage: getStat(sheet, 'fuelStorage'),
    supplyStorage: getStat(sheet, 'supplyStorage'),
    version: sheet.version,
  }
})

// Set / clear the hangar's repair-priority focus by ship EntityKey.
// shipKey = '' clears the focus and reverts to even-spread spread.
// Returns the resulting value for confirmation.
registerDebugHandle('setHangarRepairPriority', (buildingKey: string, shipKey: string) => {
  for (const b of world.query(Building, Hangar, EntityKey)) {
    if (b.get(EntityKey)!.key !== buildingKey) continue
    const cur = b.get(Hangar)!
    b.set(Hangar, { ...cur, repairPriorityShipKey: shipKey })
    return shipKey
  }
  return null
})

// Diagnostic mirror of the manager-dialog panel — throughput, damaged-
// ship list, current focus. Lets the smoke read the same numbers the
// player would see without driving the React tree.
registerDebugHandle('hangarRepairDescribe', (buildingKey: string) => {
  for (const sceneId of ['vonBraunCity', 'granadaDrydock', 'zumCity'] as const) {
    const sw = getWorld(sceneId)
    for (const b of sw.query(Building, Hangar, EntityKey)) {
      if (b.get(EntityKey)!.key !== buildingKey) continue
      return describeHangarRepair(b, sceneId)
    }
  }
  return null
})

// Run one daily repair tick. Smoke calls this N times after seating
// hangar workers + damaging the flagship to assert the repair-priority
// verb finishes restoration. `gameDay` defaults to 0; the system does
// not gate on the value yet so the smoke can pass any monotone counter.
registerDebugHandle('runHangarRepairTick', (gameDay: number = 0) => {
  return hangarRepairSystem(gameDay)
})

// ── Phase 6.2.C1 helpers ─────────────────────────────────────────────────

interface DeliverySnapshotRow extends ShipDeliveryRow {
  hangarKey: string
  sceneId: string
}

// All pending deliveries across every hangar in every scene world. Smoke
// uses this to assert the buy → in_transit → arrived → received state
// machine without depending on the React dialog tree.
registerDebugHandle('deliverySnapshot', (): DeliverySnapshotRow[] => {
  const out: DeliverySnapshotRow[] = []
  for (const sceneId of SCENE_IDS) {
    const sw = getWorld(sceneId)
    for (const b of sw.query(Building, Hangar, EntityKey)) {
      const key = b.get(EntityKey)!.key
      for (const row of b.get(Hangar)!.pendingDeliveries) {
        out.push({ ...row, hangarKey: key, sceneId })
      }
    }
  }
  return out
})

// Hangar slot occupancy snapshot — derived from docked ships, not stored.
// Smoke uses this to assert receive-delivery increments the count.
registerDebugHandle('hangarOccupancy', (buildingKey: string): {
  poiId: string | null
  capacity: Partial<Record<HangarSlotClass, number>>
  occupied: Record<string, number>
} => {
  for (const sceneId of SCENE_IDS) {
    const sw = getWorld(sceneId)
    for (const b of sw.query(Building, Hangar, EntityKey)) {
      if (b.get(EntityKey)!.key !== buildingKey) continue
      const h = b.get(Hangar)!
      const poiId = poiIdForHangarScene(sceneId)
      return {
        poiId,
        capacity: h.slotCapacity,
        occupied: poiId ? deriveHangarOccupancy(poiId) : {},
      }
    }
  }
  return { poiId: null, capacity: {}, occupied: {} }
})

// Enqueue a delivery row directly without going through the UI — used
// only when the smoke wants to bypass the buy dialog to exercise the
// arrival + receive path in isolation. Returns the row's index.
registerDebugHandle('enqueueShipDelivery', (
  buildingKey: string,
  shipClassId: string,
  orderDay: number,
  leadDays: number,
) => {
  for (const sceneId of SCENE_IDS) {
    const sw = getWorld(sceneId)
    for (const b of sw.query(Building, Hangar, EntityKey)) {
      if (b.get(EntityKey)!.key !== buildingKey) continue
      // Validate the class id up-front so a typo in the smoke surfaces
      // here rather than during the receive call.
      getShipClass(shipClassId)
      return enqueueDelivery(b, shipClassId, orderDay, leadDays)
    }
  }
  return null
})

// Run one shipDelivery tick. Smoke calls this N times after enqueuing
// to assert the in_transit → arrived flip lands at the expected day.
registerDebugHandle('runShipDeliveryTick', (gameDay: number = 0) => {
  return shipDeliverySystem(gameDay)
})

// Receive an arrived delivery via the system surface. The hangar
// manager dialog calls the same function; the smoke calls this directly
// without driving the React tree.
registerDebugHandle('receiveShipDelivery', (buildingKey: string, rowIndex: number) => {
  for (const sceneId of SCENE_IDS) {
    const sw = getWorld(sceneId)
    for (const b of sw.query(Building, Hangar, EntityKey)) {
      if (b.get(EntityKey)!.key !== buildingKey) continue
      return receiveDelivery(b, sceneId, rowIndex)
    }
  }
  return { ok: false as const, reason: 'no_row' as const }
})

// Snapshot of every ship currently alive (flagship + delivered) so the
// smoke can assert a delivered hull lands as a real Ship entity with
// dockedAtPoiId set.
registerDebugHandle('listShipsInFleet', () => {
  const w = getWorld('playerShipInterior')
  const out: Array<{
    entityKey: string
    templateId: string
    isFlagship: boolean
    dockedAtPoiId: string
    hullCurrent: number
    hullMax: number
  }> = []
  for (const e of w.query(Ship, EntityKey)) {
    const s = e.get(Ship)!
    out.push({
      entityKey: e.get(EntityKey)!.key,
      templateId: s.templateId,
      isFlagship: e.has(IsFlagshipMark),
      dockedAtPoiId: s.dockedAtPoiId,
      hullCurrent: s.hullCurrent,
      hullMax: s.hullMax,
    })
  }
  return out
})

// ── Phase 6.2.F supply / fuel debug handles ─────────────────────────────

// Find a hangar entity across every scene world by buildingKey.
function findHangarByKey(buildingKey: string): { entity: ReturnType<typeof world.queryFirst>; sceneId: string } | null {
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const b of w.query(Building, Hangar, EntityKey)) {
      if (b.get(EntityKey)!.key === buildingKey) return { entity: b, sceneId }
    }
  }
  return null
}

interface HangarSupplySnapshot {
  buildingKey: string
  supplyCurrent: number
  supplyMax: number
  fuelCurrent: number
  fuelMax: number
  pending: Array<{ kind: SupplyKind; qty: number; daysRemaining: number }>
}

// Read the supply/fuel reserves on a single hangar by buildingKey.
registerDebugHandle('hangarSupplySnapshot', (buildingKey: string): HangarSupplySnapshot | null => {
  const hit = findHangarByKey(buildingKey)
  if (!hit) return null
  const h = hit.entity!.get(Hangar)!
  return {
    buildingKey,
    supplyCurrent: h.supplyCurrent,
    supplyMax: h.supplyMax,
    fuelCurrent: h.fuelCurrent,
    fuelMax: h.fuelMax,
    pending: h.pendingSupplyDeliveries.map((d) => ({ ...d })),
  }
})

// Force-set a hangar's supply/fuel current. Smoke uses this to seed
// "almost dry" and "exactly at the run-dry threshold" states without
// running the drain N times.
registerDebugHandle('setHangarSupply', (buildingKey: string, supplyCurrent: number, fuelCurrent: number) => {
  const hit = findHangarByKey(buildingKey)
  if (!hit) return null
  const cur = hit.entity!.get(Hangar)!
  hit.entity!.set(Hangar, {
    ...cur,
    supplyCurrent: Math.max(0, Math.min(supplyCurrent, cur.supplyMax)),
    fuelCurrent: Math.max(0, Math.min(fuelCurrent, cur.fuelMax)),
  })
  return { supplyCurrent: cur.supplyCurrent, fuelCurrent: cur.fuelCurrent }
})

// Enqueue a delivery directly. Smoke uses this to bypass the dialog UI
// when asserting the delivery pipeline (the dialog path is exercised
// in its own assertion block).
registerDebugHandle('enqueueHangarDelivery', (buildingKey: string, kind: SupplyKind, qty: number, days: number) => {
  const hit = findHangarByKey(buildingKey)
  if (!hit) return null
  enqueueSupplyDelivery(hit.entity!, kind, qty, days)
  return hit.entity!.get(Hangar)!.pendingSupplyDeliveries.map((d) => ({ ...d }))
})

// Run one daily fleet-supply tick (deliveries first, then drain). Smoke
// drives this in place of the loop's day:rollover:settled event so the
// scenario is deterministic.
registerDebugHandle('runFleetSupplyTick', (gameDay: number = 0) => {
  const shipWorld = getWorld('playerShipInterior')
  const out = {
    deliveriesLanded: 0,
    unitsAppliedSupply: 0,
    unitsAppliedFuel: 0,
    drainSupply: 0,
    hangarsRunDry: 0,
  }
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    const dr = fleetSupplyDeliverySystem(w, gameDay)
    out.deliveriesLanded += dr.deliveriesLanded
    out.unitsAppliedSupply += dr.unitsAppliedSupply
    out.unitsAppliedFuel += dr.unitsAppliedFuel
    const dn = fleetSupplyDrainSystem(w, shipWorld, gameDay)
    out.drainSupply += dn.totalDrainSupply
    out.hangarsRunDry += dn.hangarsRunDry
  }
  return out
})

// Aggregate fleet-wide supply / fuel — the HUD's source-of-truth value.
registerDebugHandle('fleetSupplyTotals', () => {
  let sc = 0, sm = 0, fc = 0, fm = 0
  for (const sceneId of SCENE_IDS) {
    const r = aggregateHangarReserves(getWorld(sceneId))
    sc += r.supplyCurrent
    sm += r.supplyMax
    fc += r.fuelCurrent
    fm += r.fuelMax
  }
  return { supplyCurrent: sc, supplyMax: sm, fuelCurrent: fc, fuelMax: fm }
})

// Resolve the AE supply dealer NPC entity by spec id (talk-verb target).
registerDebugHandle('aeSupplyDealerEntity', () => {
  for (const ws of world.query(Workstation)) {
    const w = ws.get(Workstation)!
    if (w.specId !== 'ae_supply_dealer') continue
    return w.occupant ?? null
  }
  return null
})

// Resolve the secretary NPC entity. Smoke uses this to drive the bulk-
// order verbs without DOM-clicking through hire-secretary first.
registerDebugHandle('secretaryEntity', () => {
  for (const ws of world.query(Workstation)) {
    const w = ws.get(Workstation)!
    if (w.specId !== 'secretary') continue
    return w.occupant ?? null
  }
  return null
})

// Force-seat the secretary workstation with a fresh NPC, bypassing the
// installOnly gate. Avoids the full install-via-manage-cell flow for the
// smoke. Mirrors fillJobVacancies but writes Workstation.occupant
// directly instead of going through claimJob.
registerDebugHandle('forceSeatSecretary', () => {
  for (const ws of world.query(Workstation, Position)) {
    const w = ws.get(Workstation)!
    if (w.specId !== 'secretary') continue
    if (w.occupant) return w.occupant
    const wp = ws.get(Position)!
    const npc = spawnNPC(world, {
      name: pickFreshName(world),
      color: pickRandomColor(),
      title: '秘书',
      x: wp.x, y: wp.y,
    })
    ws.set(Workstation, { ...w, occupant: npc })
    // Job → Workstation link is required for NPCDialog's wsSpec lookup
    // (the dialog reads specId off `job.workstation.Workstation`, not the
    // bare Workstation table). Without this, isSecretaryOnDuty stays
    // false because the dialog thinks the NPC is unemployed.
    npc.set(Job, { workstation: ws, unemployedSinceMs: 0 })
    // Pin the action to 'working' so the on-duty role flag fires
    // without waiting on shift hours.
    npc.set(Action, { kind: 'working', remaining: 999_999_999, total: 999_999_999 })
    return npc
  }
  return null
})
