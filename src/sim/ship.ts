// High-level read/write helpers for the player flagship. Callers (UI,
// systems, other slices) should go through this instead of poking ECS
// traits directly so the new Starsector-shape stat block stays consistent.
//
// Phase 6.1.5 pluralized the Ship roster: there can be multiple Ship
// entities in the playerShipInterior world. The flagship is whichever one
// carries IsFlagshipMark — `getFlagshipEntity` is the canonical lookup.

import { getWorld } from '../ecs/world'
import { Ship, IsFlagshipMark } from '../ecs/traits'
import { useDebug } from '../debug/store'

const SHIP_SCENE_ID = 'playerShipInterior'

function shipWorld() {
  return getWorld(SHIP_SCENE_ID)
}

export function getFlagshipEntity() {
  return shipWorld().queryFirst(Ship, IsFlagshipMark)
}

export function getFleetEntities() {
  return shipWorld().query(Ship)
}

export function getShipState() {
  const ent = getFlagshipEntity()
  return ent?.get(Ship) ?? null
}

export function spendFuel(amount: number): boolean {
  const ent = getFlagshipEntity()
  if (!ent) return false
  if (useDebug.getState().infiniteFuelSupply) return true
  const s = ent.get(Ship)!
  if (s.fuelCurrent < amount) return false
  ent.set(Ship, { ...s, fuelCurrent: s.fuelCurrent - amount })
  return true
}

export function spendSupplies(amount: number): boolean {
  const ent = getFlagshipEntity()
  if (!ent) return false
  if (useDebug.getState().infiniteFuelSupply) return true
  const s = ent.get(Ship)!
  if (s.suppliesCurrent < amount) return false
  ent.set(Ship, { ...s, suppliesCurrent: s.suppliesCurrent - amount })
  return true
}

export function refillFuelAndSupplies(): boolean {
  const ent = getFlagshipEntity()
  if (!ent) return false
  const s = ent.get(Ship)!
  ent.set(Ship, { ...s, fuelCurrent: s.fuelMax, suppliesCurrent: s.suppliesMax })
  return true
}

// Damage routing: hit the armor pool first (proportional to armor pct
// remaining — Starsector style), then spill into hull. Returns destroyed
// when hull drops to 0.
export function damageHull(amount: number): { destroyed: boolean } {
  const ent = getFlagshipEntity()
  if (!ent) return { destroyed: false }
  const s = ent.get(Ship)!
  let remaining = amount
  let nextArmor = s.armorCurrent
  if (s.armorMax > 0 && nextArmor > 0) {
    const armorAbsorb = Math.min(nextArmor, remaining * (nextArmor / s.armorMax))
    nextArmor = Math.max(0, nextArmor - armorAbsorb)
    remaining = Math.max(0, remaining - armorAbsorb)
  }
  const hp = Math.max(0, s.hullCurrent - remaining)
  ent.set(Ship, { ...s, armorCurrent: nextArmor, hullCurrent: hp })
  return { destroyed: hp <= 0 }
}

export function repairHull(amount: number): void {
  const ent = getFlagshipEntity()
  if (!ent) return
  const s = ent.get(Ship)!
  const hp = Math.min(s.hullMax, s.hullCurrent + amount)
  ent.set(Ship, { ...s, hullCurrent: hp })
}

export function drainCR(amount: number): void {
  const ent = getFlagshipEntity()
  if (!ent) return
  const s = ent.get(Ship)!
  ent.set(Ship, { ...s, crCurrent: Math.max(0, s.crCurrent - amount) })
}

export function restoreCR(amount: number): void {
  const ent = getFlagshipEntity()
  if (!ent) return
  const s = ent.get(Ship)!
  ent.set(Ship, { ...s, crCurrent: Math.min(s.crMax, s.crCurrent + amount) })
}

export function getDockedPoiId(): string | null {
  const s = getShipState()
  if (!s) return null
  return s.dockedAtPoiId || null
}

export function setDockedPoi(poiId: string, fleetPos?: { x: number; y: number }): void {
  const ent = getFlagshipEntity()
  if (!ent) return
  const cur = ent.get(Ship)!
  ent.set(Ship, {
    ...cur,
    dockedAtPoiId: poiId,
    fleetPos: fleetPos ?? cur.fleetPos,
  })
}

export function setFleetPos(pos: { x: number; y: number }): void {
  const ent = getFlagshipEntity()
  if (!ent) return
  const cur = ent.get(Ship)!
  ent.set(Ship, { ...cur, fleetPos: { x: pos.x, y: pos.y } })
}

export function clearDocked(): void {
  const ent = getFlagshipEntity()
  if (!ent) return
  const cur = ent.get(Ship)!
  ent.set(Ship, { ...cur, dockedAtPoiId: '' })
}

export function setInCombat(inCombat: boolean): void {
  const ent = getFlagshipEntity()
  if (!ent) return
  ent.set(Ship, { ...ent.get(Ship)!, inCombat })
}
