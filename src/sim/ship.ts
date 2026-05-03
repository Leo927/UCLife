// High-level read/write helpers for the player ship. Callers (UI, systems,
// other slices) should go through this instead of poking ECS traits
// directly so the new Starsector-shape stat block stays consistent.

import { getWorld } from '../ecs/world'
import { Ship, type BurnPlan } from '../ecs/traits'

const SHIP_SCENE_ID = 'playerShipInterior'

function shipWorld() {
  return getWorld(SHIP_SCENE_ID)
}

export function getPlayerShipEntity() {
  return shipWorld().queryFirst(Ship)
}

export function getShipState() {
  const ent = getPlayerShipEntity()
  return ent?.get(Ship) ?? null
}

export function spendFuel(amount: number): boolean {
  const ent = getPlayerShipEntity()
  if (!ent) return false
  const s = ent.get(Ship)!
  if (s.fuelCurrent < amount) return false
  ent.set(Ship, { ...s, fuelCurrent: s.fuelCurrent - amount })
  return true
}

export function spendSupplies(amount: number): boolean {
  const ent = getPlayerShipEntity()
  if (!ent) return false
  const s = ent.get(Ship)!
  if (s.suppliesCurrent < amount) return false
  ent.set(Ship, { ...s, suppliesCurrent: s.suppliesCurrent - amount })
  return true
}

// Damage routing: hit the armor pool first (proportional to armor pct
// remaining — Starsector style), then spill into hull. Returns destroyed
// when hull drops to 0.
export function damageHull(amount: number): { destroyed: boolean } {
  const ent = getPlayerShipEntity()
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
  const ent = getPlayerShipEntity()
  if (!ent) return
  const s = ent.get(Ship)!
  const hp = Math.min(s.hullMax, s.hullCurrent + amount)
  ent.set(Ship, { ...s, hullCurrent: hp })
}

export function getDockedPoiId(): string | null {
  const s = getShipState()
  if (!s) return null
  return s.dockedAtPoiId || null
}

export function setDockedPoi(poiId: string, fleetPos?: { x: number; y: number }): void {
  const ent = getPlayerShipEntity()
  if (!ent) return
  const cur = ent.get(Ship)!
  ent.set(Ship, {
    ...cur,
    dockedAtPoiId: poiId,
    fleetPos: fleetPos ?? cur.fleetPos,
  })
}

export function setFleetPos(pos: { x: number; y: number }): void {
  const ent = getPlayerShipEntity()
  if (!ent) return
  const cur = ent.get(Ship)!
  ent.set(Ship, { ...cur, fleetPos: { x: pos.x, y: pos.y } })
}

export function clearDocked(): void {
  const ent = getPlayerShipEntity()
  if (!ent) return
  const cur = ent.get(Ship)!
  ent.set(Ship, { ...cur, dockedAtPoiId: '' })
}

export function setInCombat(inCombat: boolean): void {
  const ent = getPlayerShipEntity()
  if (!ent) return
  ent.set(Ship, { ...ent.get(Ship)!, inCombat })
}

export function getBurnPlan(): BurnPlan | null {
  return getShipState()?.burnPlan ?? null
}

export function setBurnPlan(plan: BurnPlan | null): void {
  const ent = getPlayerShipEntity()
  if (!ent) return
  ent.set(Ship, { ...ent.get(Ship)!, burnPlan: plan })
}
