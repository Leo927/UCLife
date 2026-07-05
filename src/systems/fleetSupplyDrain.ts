// Daily fleet-supply upkeep tick. Per Design/fleet.md § Supply:
//
//   fleetSupplyPerDay =
//       sum(ship.template.supplyPerDay for each non-mothballed ship)
//     + sum(ms.template.supplyPerDay for each MS in any non-mothballed hangar)
//     + sum(ms.template.supplyPerRepairDay for each MS currently in-repair)
//     + crewUpkeepPerDay
//
// 6.2.F landed the *ship-tier* term; Issue #63 folds in both MS terms
// (per-MS daily drain + the extra in-repair cost). crewUpkeep is tracked
// separately under faction salary. Starsector-style consolidation: the
// drain debits the fleet-level supply pool (FleetPool singleton) instead
// of the per-hangar warehouse — supplies are a shared fleet resource, not
// a per-dock stockpile. Hangars retain their own Hangar.supplyCurrent as
// a refill warehouse the player resupplies *from* when docked.
//
// Task 9 (W1 playable-loop) — "in-repair" now reads `Ms.damageState`
// (hangarRepair.ts's depot repair lifecycle keeps it in sync) instead of
// re-deriving from the hull/armor deficit. This is a deliberate economic
// narrowing, not just a refactor: `damageState` is only 'in-repair' while
// the MS is damaged AND parked at a depot (ecs/msDamage.ts), so a damaged
// MS still riding aboard a ship — no repair crew touching it — now pays
// only its ordinary `supplyPerDay`, not the extra `supplyPerRepairDay`.
// The old derivation billed the repair surcharge for the entire time an
// MS carried any deficit, aboard or not, which double-charged hulls that
// were mid-deployment and nowhere near a hangar crew. See Design/fleet.md's
// supply-drain note for the doc-level version of this call.
//
// Caps at zero — running dry surfaces in the manager dialog (缺补给)
// and as a HUD gauge tint without breaking the tick.
//
// Multi-world iteration: ships and MS both live in playerShipInterior
// today (post-6.2.E2 ships may live elsewhere). The caller
// (boot/fleetSupplyTick.ts) hands in both the ship world and the MS
// world so this module stays decoupled from getWorld().
//
// Perf (Issue #63): O(S + M) over ships + MS, once per day:rollover. At
// the target N (~12 MS, fleet of 3 carriers × 4 MS) the MS walk is one
// stat read per MS and a single aggregate debit — comfortably sub-budget
// for a once-per-day O(M) walk, so no *_PROF gate.

import type { Entity, World } from 'koota'
import {
  Building, Hangar, Ms, MsStatSheet, Ship, ShipStatSheet, EntityKey, WasCaptured,
} from '../ecs/traits'
import { getStat } from '../stats/sheet'
import { getMsClass } from '../data/ms'
import { spendFleetSupply } from '../ecs/fleetPool'

// Issue #71 — a captured hull that has not yet reached a home hangar
// (WasCaptured + homeHangarId empty) is in the in-flight pattern: it draws
// from its OWN currentSupply / currentFuel (halved at capture), not from
// the shared fleet pool. Returns true while the ship is in that state.
function isInFlightCaptured(ship: Entity): boolean {
  if (!ship.has(WasCaptured)) return false
  const s = ship.get(Ship)
  return !!s && s.homeHangarId === ''
}

export interface FleetSupplyDrainResult {
  shipsDraining: number
  msDraining: number
  totalDrainSupply: number
  ranDry: boolean
}

// Walks every Ship in `shipWorld` plus every Ms in `msWorld`, aggregates
// the daily supply drain (ship supplyPerDay + per-MS supplyPerDay + the
// in-repair supplyPerRepairDay for damaged MS), and debits the fleet pool
// in one shot (cap at 0). Mothball gating: a mothballed ship contributes
// nothing, and an MS stored aboard a mothballed ship is skipped too.
//
// The `spend` parameter is the seam tests use to isolate the global
// FleetPool singleton — production code defaults to the real fleet-pool
// debit.
//
// Idempotent within a day: relies on the caller to fire exactly once
// per `day:rollover:settled`. The boot subscription enforces this.
export function fleetSupplyDrainSystem(
  shipWorld: World,
  msWorld: World,
  _gameDay: number,
  spend: (amount: number) => number = spendFleetSupply,
): FleetSupplyDrainResult {
  const result: FleetSupplyDrainResult = {
    shipsDraining: 0,
    msDraining: 0,
    totalDrainSupply: 0,
    ranDry: false,
  }

  let requested = 0
  const mothballedShipKeys = new Set<string>()
  for (const ship of shipWorld.query(Ship)) {
    const s = ship.get(Ship)!
    if (s.mothballed) {
      const key = ship.get(EntityKey)?.key
      if (key) mothballedShipKeys.add(key)
      continue
    }
    const perDay = supplyPerDayOf(ship)
    if (perDay <= 0) continue
    // Issue #71 — captured in-flight hulls draw their OWN bunkers, not the
    // fleet pool. Debit in-place and skip the pooled request.
    if (isInFlightCaptured(ship)) {
      ship.set(Ship, { ...s, currentSupply: Math.max(0, s.currentSupply - perDay) })
      continue
    }
    result.shipsDraining += 1
    requested += perDay
  }

  for (const msEnt of msWorld.query(Ms)) {
    const m = msEnt.get(Ms)!
    // An MS aboard a mothballed ship is laid up alongside it — no drain.
    // An MS parked at a POI hangar (no storedOnShipKey) is never mothballed.
    if (m.storedOnShipKey && mothballedShipKeys.has(m.storedOnShipKey)) continue
    let contribution = msSupplyPerDayOf(msEnt)
    if (m.damageState === 'in-repair') contribution += msSupplyPerRepairDayOf(msEnt)
    if (contribution <= 0) continue
    result.msDraining += 1
    requested += contribution
  }

  if (requested <= 0) return result

  const applied = spend(requested)
  result.totalDrainSupply = applied
  result.ranDry = applied < requested
  return result
}

// Public for the HUD readout. Aggregates the current supplyCurrent +
// supplyMax (and fuel) across every hangar in the passed world (the
// surface + orbital-drydock hangars now share the vonBraunCity world).
export function aggregateHangarReserves(hangarWorld: World): {
  supplyCurrent: number; supplyMax: number;
  fuelCurrent: number; fuelMax: number;
} {
  let sc = 0, sm = 0, fc = 0, fm = 0
  for (const ent of hangarWorld.query(Building, Hangar)) {
    const h = ent.get(Hangar)!
    sc += h.supplyCurrent
    sm += h.supplyMax
    fc += h.fuelCurrent
    fm += h.fuelMax
  }
  return { supplyCurrent: sc, supplyMax: sm, fuelCurrent: fc, fuelMax: fm }
}

function supplyPerDayOf(ship: Entity): number {
  // Authoritative read from the ShipStatSheet — Effects may modify
  // (officer-bonus to logistics, faction research, doctrine). Falls back
  // to 0 when no sheet is attached (legacy entities pre-6.2.B).
  if (!ship.has(ShipStatSheet)) return 0
  return getStat(ship.get(ShipStatSheet)!.sheet, 'supplyPerDay')
}

// Authoritative read from the MsStatSheet — mirrors supplyPerDayOf(ship)
// so frame-mod / research Effects can modify it. Falls back to the MS
// class template when no sheet is attached (defensive — every spawned MS
// gets a sheet via attachMsStatSheet).
function msSupplyPerDayOf(msEnt: Entity): number {
  const ss = msEnt.get(MsStatSheet)
  if (ss) return getStat(ss.sheet, 'supplyPerDay')
  return templateMsStat(msEnt, 'supplyPerDay')
}

function msSupplyPerRepairDayOf(msEnt: Entity): number {
  const ss = msEnt.get(MsStatSheet)
  if (ss) return getStat(ss.sheet, 'supplyPerRepairDay')
  return templateMsStat(msEnt, 'supplyPerRepairDay')
}

function templateMsStat(msEnt: Entity, field: 'supplyPerDay' | 'supplyPerRepairDay'): number {
  const m = msEnt.get(Ms)
  if (!m) return 0
  return getMsClass(m.templateId)[field]
}

