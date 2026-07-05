// Phase 6.2.B hangar repair system. Runs once per game day from the
// `day:rollover` chain in src/sim/loop.ts. For each Hangar facility:
//
//   dailyThroughput  =  Σ(worker.workPerformance) × manager.workPerformance × baseRepairPerWorker
//   spread            =  dailyThroughput / count(targets not yet fully repaired at this POI)
//
// If the hangar's `repairPriorityShipKey` is set, the full pool focuses
// on that one target (ship OR MS, matched by EntityKey) until it's fully
// restored — the player's override on the spread.
//
// Repair flows armor-first, then hull (Starsector pattern — ablative
// armor is the outer layer to rebuild). Excess points roll to the next
// damaged target in the spread, so a single tick can finish one target's
// armor restoration and start hull repair on another.
//
// At 6.2.B the only docked-ship lookup is "ship.dockedAtPoiId matches
// the hangar's host POI." Multi-hangar-per-POI assignment is a 6.2.G
// concern (transfer-to-other-hangar plumbing); for the demo the VB
// state hangar repairs the flagship the moment it docks at vonBraun.
//
// Task 9 (W1 playable-loop) — depot MS share the same throughput pool.
// `dockedAtPoiId` is the depot-custody invariant (Task 8): an MS still
// aboard a ship never has it set, so `findDamagedMsAtPoi` naturally
// excludes aboard MS without an extra check. Ships and MS are collapsed
// into one `RepairTarget` list so the existing focus/spread accumulator
// doesn't need to know which kind it's holding.

import type { Entity, World } from 'koota'
import {
  Building, Hangar, Position, Workstation, Attributes,
  Ship, ShipStatSheet, Ms, EntityKey,
} from '../ecs/traits'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { poiIdForHangar } from '../data/pois'
import { getJobSpec } from '../data/jobs'
import { fleetConfig } from '../config'
import { getStat } from '../stats/sheet'
import { computeMsDamageState } from '../ecs/msDamage'

export interface HangarRepairResult {
  hangarsTicked: number
  shipsRepaired: number
  msRepaired: number
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
    msRepaired: 0,
    pointsApplied: 0,
  }

  // Hangars sit in city scenes; ships + MS sit in playerShipInterior. Walk
  // every scene's hangars; for each, resolve its host POI; match docked
  // ships/MS across all worlds (today: just playerShipInterior).
  for (const sceneId of SCENE_IDS) {
    const sceneWorld = getWorld(sceneId)
    for (const hangarEnt of sceneWorld.query(Building, Hangar)) {
      const poiId = poiIdForHangar(sceneId, hangarEnt.get(Building)!)
      if (!poiId) continue
      const targets: RepairTarget[] = [
        ...findDamagedShipsAtPoi(poiId).map(shipRepairTarget),
        ...findDamagedMsAtPoi(poiId).map(msRepairTarget),
      ]
      if (targets.length === 0) continue

      const throughput = computeHangarThroughput(sceneWorld, hangarEnt)
      if (throughput <= 0) continue
      result.hangarsTicked += 1

      const focusKey = hangarEnt.get(Hangar)!.repairPriorityShipKey
      const focusTarget = focusKey
        ? targets.find((t) => t.key === focusKey) ?? null
        : null

      if (focusTarget) {
        const applied = focusTarget.applyPoints(throughput)
        result.pointsApplied += applied
        if (focusTarget.isFullyRepaired()) {
          tallyRepaired(result, focusTarget)
          // Clear the priority slot — the player picks the next one
          // explicitly via the manager verb. Leaving it pinned would
          // silently re-focus on a destroyed-then-restored hull.
          const cur = hangarEnt.get(Hangar)!
          hangarEnt.set(Hangar, { ...cur, repairPriorityShipKey: '' })
        }
        continue
      }

      // Spread evenly across docked-and-damaged targets. Overflow from a
      // target that finishes early rolls to the next damaged one — the
      // accumulator pattern lets a single tick complete multiple targets
      // without leaving leftover points on the floor.
      let remaining = throughput
      let damaged = targets.slice()
      while (remaining > 0 && damaged.length > 0) {
        const share = remaining / damaged.length
        let progressed = false
        for (const target of damaged) {
          if (share <= 0) break
          const before = target.deficit()
          if (before <= 0) continue
          const applied = target.applyPoints(Math.min(share, before))
          if (applied > 0) progressed = true
          result.pointsApplied += applied
          remaining -= applied
        }
        damaged = damaged.filter((t) => !t.isFullyRepaired())
        if (!progressed) break
      }
      for (const target of targets) {
        if (target.isFullyRepaired()) tallyRepaired(result, target)
      }
    }
  }

  return result
}

// One repairable unit — a Ship or an Ms, collapsed to a common surface so
// the focus/spread accumulator above doesn't need to know which kind it's
// holding. `deficit` / `applyPoints` operate on whichever trait the
// underlying entity carries.
interface RepairTarget {
  kind: 'ship' | 'ms'
  key: string
  deficit: () => number
  applyPoints: (points: number) => number
  isFullyRepaired: () => boolean
}

function tallyRepaired(result: HangarRepairResult, target: RepairTarget): void {
  if (target.kind === 'ship') result.shipsRepaired += 1
  else result.msRepaired += 1
}

interface RepairableFields {
  hullCurrent: number
  hullMax: number
  armorCurrent: number
  armorMax: number
}

function repairDeficitOf(f: RepairableFields): number {
  return (f.hullMax - f.hullCurrent) + (f.armorMax - f.armorCurrent)
}

// Apply `points` of repair, armor-first then hull. Returns the resulting
// field values + the actually-applied count (≤ points and ≤ deficit).
function applyRepairToFields<F extends RepairableFields>(
  f: F, points: number,
): { updated: F; applied: number } {
  let remaining = points
  let nextArmor = f.armorCurrent
  let nextHull = f.hullCurrent
  if (nextArmor < f.armorMax) {
    const give = Math.min(f.armorMax - nextArmor, remaining)
    nextArmor += give
    remaining -= give
  }
  if (remaining > 0 && nextHull < f.hullMax) {
    const give = Math.min(f.hullMax - nextHull, remaining)
    nextHull += give
    remaining -= give
  }
  const applied = points - remaining
  return { updated: { ...f, armorCurrent: nextArmor, hullCurrent: nextHull }, applied }
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
    if (repairDeficitOf(s) <= 0) continue
    out.push(ent)
  }
  return out
}

// Task 9 — depot-only per the custody invariant (Task 8): an MS aboard a
// ship never has `dockedAtPoiId` set, so this naturally excludes it even
// if its host ship happens to be docked at the same POI.
function findDamagedMsAtPoi(poiId: string): Entity[] {
  const msWorld = getWorld('playerShipInterior')
  const out: Entity[] = []
  for (const ent of msWorld.query(Ms)) {
    const m = ent.get(Ms)!
    if (m.dockedAtPoiId !== poiId) continue
    if (repairDeficitOf(m) <= 0) continue
    out.push(ent)
  }
  return out
}

function shipRepairTarget(ship: Entity): RepairTarget {
  return {
    kind: 'ship',
    key: ship.get(EntityKey)?.key ?? '',
    deficit: () => {
      const s = ship.get(Ship)
      return s ? repairDeficitOf(s) : 0
    },
    applyPoints: (points) => applyRepairToShip(ship, points),
    isFullyRepaired: () => {
      const s = ship.get(Ship)
      return !s || repairDeficitOf(s) <= 0
    },
  }
}

function msRepairTarget(msEnt: Entity): RepairTarget {
  return {
    kind: 'ms',
    key: msEnt.get(EntityKey)?.key ?? '',
    deficit: () => {
      const m = msEnt.get(Ms)
      return m ? repairDeficitOf(m) : 0
    },
    applyPoints: (points) => applyRepairToMs(msEnt, points),
    isFullyRepaired: () => {
      const m = msEnt.get(Ms)
      return !m || repairDeficitOf(m) <= 0
    },
  }
}

function applyRepairToShip(ship: Entity, points: number): number {
  const s = ship.get(Ship)
  if (!s) return 0
  const { updated, applied } = applyRepairToFields(s, points)
  if (applied <= 0) return 0
  ship.set(Ship, updated)
  // 6.2.B doesn't yet wire damage Effects on the ship sheet, but the
  // sheet exists — bump its version so a future getStat() cache miss
  // doesn't read a stale folded value once doctrine / damage Effects
  // start landing.
  const ss = ship.get(ShipStatSheet)
  if (ss) ship.set(ShipStatSheet, { sheet: ss.sheet })
  return applied
}

function applyRepairToMs(msEnt: Entity, points: number): number {
  const m = msEnt.get(Ms)
  if (!m) return 0
  const { updated, applied } = applyRepairToFields(m, points)
  if (applied <= 0) return 0
  msEnt.set(Ms, { ...updated, damageState: computeMsDamageState(updated) })
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
  const poiId = poiIdForHangar(sceneId, hangarEnt.get(Building)!)
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

