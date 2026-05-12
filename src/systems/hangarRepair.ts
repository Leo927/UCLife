// Phase 6.2.B hangar repair system. Runs once per game day from the
// `day:rollover` chain in src/sim/loop.ts. For each Hangar facility:
//
//   dailyThroughput  =  Σ(worker.workPerformance) × manager.workPerformance × baseRepairPerWorker
//   spread            =  dailyThroughput / count(ships not yet fully repaired at this POI)
//
// If the hangar's `repairPriorityShipKey` is set, the full pool focuses
// on that one ship until it's fully restored — the player's override on
// the spread.
//
// Repair flows armor-first, then hull (Starsector pattern — ablative
// armor is the outer layer to rebuild). Excess points roll to the next
// damaged ship in the spread, so a single tick can finish one ship's
// armor restoration and start hull repair on another.
//
// At 6.2.B the only docked-ship lookup is "ship.dockedAtPoiId matches
// the hangar's host POI." Multi-hangar-per-POI assignment is a 6.2.G
// concern (transfer-to-other-hangar plumbing); for the demo the VB
// state hangar repairs the flagship the moment it docks at vonBraun.

import type { Entity, World } from 'koota'
import {
  Building, Hangar, Position, Workstation, Attributes,
  Ship, ShipStatSheet, EntityKey,
} from '../ecs/traits'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { POIS } from '../data/pois'
import { getJobSpec } from '../data/jobs'
import { fleetConfig } from '../config'
import { getStat } from '../stats/sheet'

export interface HangarRepairResult {
  hangarsTicked: number
  shipsRepaired: number
  pointsApplied: number
}

// `gameDay` is the integer day number AFTER the rollover flipped.
// Idempotent within a day via Hangar's host facility's lastRolloverDay
// — but the daily-economics handler already enforces that at the
// scene-wide level by running once per day, so we don't double-guard.
export function hangarRepairSystem(_gameDay: number): HangarRepairResult {
  const result: HangarRepairResult = {
    hangarsTicked: 0,
    shipsRepaired: 0,
    pointsApplied: 0,
  }

  // Hangars sit in city scenes; ships sit in playerShipInterior. Walk
  // every scene's hangars; for each, resolve its host POI; match docked
  // ships across all worlds (today: just playerShipInterior).
  for (const sceneId of SCENE_IDS) {
    const sceneWorld = getWorld(sceneId)
    for (const hangarEnt of sceneWorld.query(Building, Hangar)) {
      const poiId = poiIdForScene(sceneId)
      if (!poiId) continue
      const dockedShips = findDamagedShipsAtPoi(poiId)
      if (dockedShips.length === 0) continue

      const throughput = computeHangarThroughput(sceneWorld, hangarEnt)
      if (throughput <= 0) continue
      result.hangarsTicked += 1

      const focusKey = hangarEnt.get(Hangar)!.repairPriorityShipKey
      const focusShip = focusKey
        ? dockedShips.find((ent) => ent.get(EntityKey)?.key === focusKey) ?? null
        : null

      if (focusShip) {
        const applied = applyRepair(focusShip, throughput)
        result.pointsApplied += applied
        if (isFullyRepaired(focusShip)) {
          result.shipsRepaired += 1
          // Clear the priority slot — the player picks the next one
          // explicitly via the manager verb. Leaving it pinned would
          // silently re-focus on a destroyed-then-restored hull.
          const cur = hangarEnt.get(Hangar)!
          hangarEnt.set(Hangar, { ...cur, repairPriorityShipKey: '' })
        }
        continue
      }

      // Spread evenly across docked-and-damaged ships. Overflow from a
      // ship that finishes early rolls to the next damaged one — the
      // accumulator pattern lets a single tick complete multiple ships
      // without leaving leftover points on the floor.
      let remaining = throughput
      let damaged = dockedShips.slice()
      while (remaining > 0 && damaged.length > 0) {
        const share = remaining / damaged.length
        let progressed = false
        for (const ship of damaged) {
          if (share <= 0) break
          const before = repairDeficit(ship)
          if (before <= 0) continue
          const applied = applyRepair(ship, Math.min(share, before))
          if (applied > 0) progressed = true
          result.pointsApplied += applied
          remaining -= applied
        }
        damaged = damaged.filter((s) => !isFullyRepaired(s))
        if (!progressed) break
      }
      for (const ship of dockedShips) {
        if (isFullyRepaired(ship)) result.shipsRepaired += 1
      }
    }
  }

  return result
}

function poiIdForScene(sceneId: string): string | null {
  for (const poi of POIS) {
    if (poi.sceneId === sceneId) return poi.id
  }
  return null
}

function findDamagedShipsAtPoi(poiId: string): Entity[] {
  // Ships live in playerShipInterior today. When 6.2.E2 splits non-
  // flagship ships off into their own homeHangar entities the lookup
  // generalizes; for 6.2.B the single-world walk is correct.
  const shipWorld = getWorld('playerShipInterior')
  const out: Entity[] = []
  for (const ent of shipWorld.query(Ship)) {
    const s = ent.get(Ship)!
    if (s.dockedAtPoiId !== poiId) continue
    if (repairDeficit(ent) <= 0) continue
    out.push(ent)
  }
  return out
}

function repairDeficit(ship: Entity): number {
  const s = ship.get(Ship)
  if (!s) return 0
  return (s.hullMax - s.hullCurrent) + (s.armorMax - s.armorCurrent)
}

function isFullyRepaired(ship: Entity): boolean {
  return repairDeficit(ship) <= 0
}

// Apply `points` of repair to a ship. Armor first, then hull. Returns
// the actually-applied count (≤ points and ≤ deficit).
function applyRepair(ship: Entity, points: number): number {
  const s = ship.get(Ship)
  if (!s) return 0
  let remaining = points
  let nextArmor = s.armorCurrent
  let nextHull = s.hullCurrent
  if (nextArmor < s.armorMax) {
    const give = Math.min(s.armorMax - nextArmor, remaining)
    nextArmor += give
    remaining -= give
  }
  if (remaining > 0 && nextHull < s.hullMax) {
    const give = Math.min(s.hullMax - nextHull, remaining)
    nextHull += give
    remaining -= give
  }
  const applied = points - remaining
  if (applied <= 0) return 0
  ship.set(Ship, { ...s, armorCurrent: nextArmor, hullCurrent: nextHull })
  // 6.2.B doesn't yet wire damage Effects on the ship sheet, but the
  // sheet exists — bump its version so a future getStat() cache miss
  // doesn't read a stale folded value once doctrine / damage Effects
  // start landing.
  const ss = ship.get(ShipStatSheet)
  if (ss) ship.set(ShipStatSheet, { sheet: ss.sheet })
  return applied
}

function computeHangarThroughput(sceneWorld: World, hangarEnt: Entity): number {
  const bld = hangarEnt.get(Building)!
  let workerSum = 0
  let managerScale = clamp(1.0, fleetConfig.managerScaleMin, fleetConfig.managerScaleMax)
  let hasManager = false

  for (const ws of sceneWorld.query(Workstation, Position)) {
    const pos = ws.get(Position)!
    if (!buildingContains(bld, pos)) continue
    const w = ws.get(Workstation)!
    if (!w.occupant) continue
    const spec = getJobSpec(w.specId)
    if (!spec) continue
    const perf = workPerformance(w.occupant)
    if (w.specId === 'hangar_worker') {
      workerSum += clamp(perf, fleetConfig.perfMin, fleetConfig.perfMax)
    } else if (w.specId === 'hangar_manager') {
      hasManager = true
      managerScale = clamp(perf, fleetConfig.managerScaleMin, fleetConfig.managerScaleMax)
    }
  }

  if (!hasManager) {
    // No seated manager → fall back to the manager-scale floor so the
    // hangar still produces baseline output. Mirrors the realty.ts +
    // research.ts "operate without supervisor" pattern.
    managerScale = fleetConfig.managerScaleMin
  }

  return workerSum * managerScale * fleetConfig.baseRepairPerWorker
}

function workPerformance(npc: Entity): number {
  const a = npc.get(Attributes)
  if (!a) return 1
  return getStat(a.sheet, 'workPerfMul')
}

function buildingContains(bld: { x: number; y: number; w: number; h: number }, p: { x: number; y: number }): boolean {
  return p.x >= bld.x && p.x < bld.x + bld.w && p.y >= bld.y && p.y < bld.y + bld.h
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : (v > hi ? hi : v)
}

// Public for the smoke test + manager-dialog readout. The Owner check
// here matches the daily-economics gate (state hangars run with the
// state's baseline staff and tick repair just like player-owned ones).
export function describeHangarRepair(hangarEnt: Entity, sceneId: string): {
  throughput: number
  damagedShipKeys: string[]
  priorityShipKey: string
} {
  const sceneWorld = getWorld(sceneId)
  const throughput = computeHangarThroughput(sceneWorld, hangarEnt)
  const poiId = poiIdForScene(sceneId)
  const damaged: string[] = []
  if (poiId) {
    for (const ship of findDamagedShipsAtPoi(poiId)) {
      const key = ship.get(EntityKey)?.key
      if (key) damaged.push(key)
    }
  }
  const cur = hangarEnt.get(Hangar)!
  return {
    throughput,
    damagedShipKeys: damaged,
    priorityShipKey: cur.repairPriorityShipKey,
  }
}

