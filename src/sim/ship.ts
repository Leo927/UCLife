// High-level read/write helpers for the player ship. Callers (UI, systems,
// other slices) should go through this instead of poking ECS traits
// directly so invariants — e.g. Ship.reactorAllocated == sum of system
// powerAllocs — stay tight.

import { getWorld } from '../ecs/world'
import { Ship, ShipSystemState } from '../ecs/traits'
import type { SystemId } from '../data/shipSystems'

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

export function damageHull(amount: number): { destroyed: boolean } {
  const ent = getPlayerShipEntity()
  if (!ent) return { destroyed: false }
  const s = ent.get(Ship)!
  const hp = Math.max(0, s.hullCurrent - amount)
  ent.set(Ship, { ...s, hullCurrent: hp })
  return { destroyed: hp <= 0 }
}

export function repairHull(amount: number): void {
  const ent = getPlayerShipEntity()
  if (!ent) return
  const s = ent.get(Ship)!
  const hp = Math.min(s.hullMax, s.hullCurrent + amount)
  ent.set(Ship, { ...s, hullCurrent: hp })
}

// Routes `level` power bars to a given system. Fails silently (returns
// false) when out of range, beyond installedLevel, or beyond the reactor's
// remaining headroom. operating-`level` is clamped to installedLevel — a
// player-routed surplus does nothing once the install cap is hit.
export function setSystemPower(systemId: SystemId, level: number): boolean {
  const w = shipWorld()
  const ship = w.queryFirst(Ship)
  if (!ship) return false

  let sysEnt: ReturnType<typeof w.queryFirst> = undefined
  for (const e of w.query(ShipSystemState)) {
    if (e.get(ShipSystemState)!.systemId === systemId) {
      sysEnt = e
      break
    }
  }
  if (!sysEnt) return false

  const cur = sysEnt.get(ShipSystemState)!
  const sState = ship.get(Ship)!
  const delta = level - cur.powerAlloc
  if (level < 0 || level > cur.installedLevel) return false
  if (sState.reactorAllocated + delta > sState.reactorMax) return false

  sysEnt.set(ShipSystemState, {
    ...cur,
    powerAlloc: level,
    level: Math.min(level, cur.installedLevel),
  })
  ship.set(Ship, { ...sState, reactorAllocated: sState.reactorAllocated + delta })
  return true
}

export function getDockedNodeId(): string | null {
  const s = getShipState()
  if (!s) return null
  return s.dockedAtNodeId || null
}

export function setDockedNode(nodeId: string): void {
  const ent = getPlayerShipEntity()
  if (!ent) return
  ent.set(Ship, { ...ent.get(Ship)!, dockedAtNodeId: nodeId })
}

export function setInCombat(inCombat: boolean): void {
  const ent = getPlayerShipEntity()
  if (!ent) return
  ent.set(Ship, { ...ent.get(Ship)!, inCombat })
}
