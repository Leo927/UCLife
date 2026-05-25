// Fleet-level fuel pool helpers. The FleetPool trait itself is a singleton
// in the playerShipInterior world; capacity (fuelMax) is the sum of
// fuelStorage across active-fleet, non-mothballed ships, recomputed on
// roster changes. Out of combat this is the sole source of truth for
// fleet fuel — per-ship Ship.fuelCurrent / fuelMax no longer exist.

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
  return w.spawn(FleetPool({ fuelCurrent: 0, fuelMax: 0 }))
}

export function getFleetPool(): { fuelCurrent: number; fuelMax: number } {
  const ent = shipWorld().queryFirst(FleetPool)
  if (!ent) return { fuelCurrent: 0, fuelMax: 0 }
  const p = ent.get(FleetPool)!
  return { fuelCurrent: p.fuelCurrent, fuelMax: p.fuelMax }
}

function computeFleetFuelMax(): number {
  let sum = 0
  for (const e of shipWorld().query(Ship, IsInActiveFleet, ShipStatSheet)) {
    const s = e.get(Ship)!
    if (s.mothballed) continue
    sum += getStat(e.get(ShipStatSheet)!.sheet, 'fuelStorage')
  }
  return sum
}

// Recompute FleetPool.fuelMax from the current roster. Clamps fuelCurrent
// to the new ceiling but never raises it unless `topUp: true` is passed
// (used at bootstrap + after a delivered ship lands so the player isn't
// stranded with new capacity and an old current).
export function recomputeFleetFuelMax(opts: { topUp?: boolean } = {}): void {
  const ent = getOrCreateFleetPoolEntity()
  const cur = ent.get(FleetPool)!
  const fuelMax = computeFleetFuelMax()
  const fuelCurrent = opts.topUp ? fuelMax : Math.min(cur.fuelCurrent, fuelMax)
  ent.set(FleetPool, { fuelCurrent, fuelMax })
}

export function refillFleetFuel(): void {
  const ent = getOrCreateFleetPoolEntity()
  const cur = ent.get(FleetPool)!
  ent.set(FleetPool, { ...cur, fuelCurrent: cur.fuelMax })
}

export function spendFleetFuel(amount: number): boolean {
  const ent = shipWorld().queryFirst(FleetPool)
  if (!ent) return false
  const p = ent.get(FleetPool)!
  if (p.fuelCurrent < amount) return false
  ent.set(FleetPool, { ...p, fuelCurrent: p.fuelCurrent - amount })
  return true
}

export function grantFleetFuel(amount: number): { fuelAfter: number; fuelMax: number } {
  const ent = getOrCreateFleetPoolEntity()
  const p = ent.get(FleetPool)!
  const fuelAfter = Math.min(p.fuelMax, p.fuelCurrent + amount)
  ent.set(FleetPool, { ...p, fuelCurrent: fuelAfter })
  return { fuelAfter, fuelMax: p.fuelMax }
}

export function setFleetPool(state: { fuelCurrent: number; fuelMax: number }): void {
  const ent = getOrCreateFleetPoolEntity()
  ent.set(FleetPool, { fuelCurrent: state.fuelCurrent, fuelMax: state.fuelMax })
}
