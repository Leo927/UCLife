// Phase 6.2.A hangar debug handles. Lets the smoke suite locate the
// state-rental hangar, inspect its facility shape (tier, slotCapacity),
// and resolve the manager NPC entity for the talk-verb assertion.
//
// Phase 6.2.B extends with: damageFlagship, setHangarRepairPriority,
// runHangarRepairTick — the deterministic drivers the smoke uses to
// exercise persistent damage + repair throughput without leaning on
// real-time loop scheduling.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { world, getWorld } from '../../ecs/world'
import {
  Building, Character, EntityKey, Hangar, Owner, Position, Workstation, Ship,
  IsFlagshipMark, ShipStatSheet,
  type HangarSlotClass, type HangarTier,
} from '../../ecs/traits'
import { worldConfig } from '../../config'
import { hangarRepairSystem, describeHangarRepair } from '../../systems/hangarRepair'
import { getStat } from '../../stats/sheet'

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
