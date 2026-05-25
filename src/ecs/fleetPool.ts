// Fleet-level fuel + supply pool helpers. The FleetPool trait itself is
// a singleton in the playerShipInterior world; capacities (fuelMax /
// supplyMax) are sums of fuelStorage / supplyStorage across active-fleet,
// non-mothballed ships, recomputed on roster changes. Out of combat
// these are the sole sources of truth — per-ship fuel/supply reserves
// no longer exist. Hangars retain their own warehouse stockpiles
// (Hangar.fuelCurrent / supplyCurrent) which the player refuels /
// resupplies *from* when docked.

import { getWorld } from './world'
import { Ship, IsInActiveFleet, ShipStatSheet, FleetPool } from './traits'
import { getStat } from '../stats/sheet'

const SHIP_SCENE_ID = 'playerShipInterior'

function shipWorld() {
  return getWorld(SHIP_SCENE_ID)
}

function getOrCreateFleetPoolEntity() {
  const w = shipWorld()
  const existing = w.queryFirst(FleetPool)
  if (existing) return existing
  return w.spawn(FleetPool({ fuelCurrent: 0, fuelMax: 0, supplyCurrent: 0, supplyMax: 0 }))
}

export interface FleetPoolView {
  fuelCurrent: number
  fuelMax: number
  supplyCurrent: number
  supplyMax: number
}

export function getFleetPool(): FleetPoolView {
  const ent = shipWorld().queryFirst(FleetPool)
  if (!ent) return { fuelCurrent: 0, fuelMax: 0, supplyCurrent: 0, supplyMax: 0 }
  const p = ent.get(FleetPool)!
  return {
    fuelCurrent: p.fuelCurrent,
    fuelMax: p.fuelMax,
    supplyCurrent: p.supplyCurrent,
    supplyMax: p.supplyMax,
  }
}

function sumStat(statId: 'fuelStorage' | 'supplyStorage'): number {
  let sum = 0
  for (const e of shipWorld().query(Ship, IsInActiveFleet, ShipStatSheet)) {
    const s = e.get(Ship)!
    if (s.mothballed) continue
    sum += getStat(e.get(ShipStatSheet)!.sheet, statId)
  }
  return sum
}

// Recompute FleetPool capacities from the current roster. Clamps
// currents to the new ceilings; never raises them unless `topUp: true`
// is passed (bootstrap + delivered-ship arrival).
export function recomputeFleetPool(opts: { topUp?: boolean } = {}): void {
  const ent = getOrCreateFleetPoolEntity()
  const cur = ent.get(FleetPool)!
  const fuelMax = sumStat('fuelStorage')
  const supplyMax = sumStat('supplyStorage')
  const fuelCurrent = opts.topUp ? fuelMax : Math.min(cur.fuelCurrent, fuelMax)
  const supplyCurrent = opts.topUp ? supplyMax : Math.min(cur.supplyCurrent, supplyMax)
  ent.set(FleetPool, { fuelCurrent, fuelMax, supplyCurrent, supplyMax })
}

// Legacy alias — kept so callers that only touched fuel don't all need
// renaming in one go. Recomputes both axes; the name is the only thing
// fuel-specific. Prefer `recomputeFleetPool` in new code.
export const recomputeFleetFuelMax = recomputeFleetPool

export function refillFleetFuel(): void {
  const ent = getOrCreateFleetPoolEntity()
  const cur = ent.get(FleetPool)!
  ent.set(FleetPool, { ...cur, fuelCurrent: cur.fuelMax })
}

export function refillFleetSupplies(): void {
  const ent = getOrCreateFleetPoolEntity()
  const cur = ent.get(FleetPool)!
  ent.set(FleetPool, { ...cur, supplyCurrent: cur.supplyMax })
}

export function spendFleetFuel(amount: number): boolean {
  const ent = shipWorld().queryFirst(FleetPool)
  if (!ent) return false
  const p = ent.get(FleetPool)!
  if (p.fuelCurrent < amount) return false
  ent.set(FleetPool, { ...p, fuelCurrent: p.fuelCurrent - amount })
  return true
}

export function spendFleetSupply(amount: number): number {
  // Returns the amount actually spent (capped at availability). Daily
  // drain wants partial debit + a "ran dry" signal; combat / one-shot
  // verbs treat anything < amount as failure.
  const ent = shipWorld().queryFirst(FleetPool)
  if (!ent) return 0
  const p = ent.get(FleetPool)!
  const applied = Math.min(amount, p.supplyCurrent)
  if (applied > 0) {
    ent.set(FleetPool, { ...p, supplyCurrent: p.supplyCurrent - applied })
  }
  return applied
}

export function grantFleetFuel(amount: number): { fuelAfter: number; fuelMax: number } {
  const ent = getOrCreateFleetPoolEntity()
  const p = ent.get(FleetPool)!
  const fuelAfter = Math.min(p.fuelMax, p.fuelCurrent + amount)
  ent.set(FleetPool, { ...p, fuelCurrent: fuelAfter })
  return { fuelAfter, fuelMax: p.fuelMax }
}

export function grantFleetSupply(amount: number): { supplyAfter: number; supplyMax: number } {
  const ent = getOrCreateFleetPoolEntity()
  const p = ent.get(FleetPool)!
  const supplyAfter = Math.min(p.supplyMax, p.supplyCurrent + amount)
  ent.set(FleetPool, { ...p, supplyCurrent: supplyAfter })
  return { supplyAfter, supplyMax: p.supplyMax }
}

export function setFleetPool(state: Partial<FleetPoolView>): void {
  const ent = getOrCreateFleetPoolEntity()
  const cur = ent.get(FleetPool)!
  ent.set(FleetPool, {
    fuelCurrent: state.fuelCurrent ?? cur.fuelCurrent,
    fuelMax: state.fuelMax ?? cur.fuelMax,
    supplyCurrent: state.supplyCurrent ?? cur.supplyCurrent,
    supplyMax: state.supplyMax ?? cur.supplyMax,
  })
}
