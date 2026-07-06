// Phase 6.2.5.C — per-MS sortie resource drain.
//
// Called from combat.ts each tick. Drains `currentPropellant` under
// thrust input on the player-piloted MS, `currentLifeSupport` continuously,
// and `currentAmmoByWeapon[hpId]` on fire events via `tryConsumeAmmo`.
//
// Gate predicates: `isMsStranded(msKey)` returns true when propellant
// hit zero; combat.ts uses it to zero the WASD thrust input so the MS
// drifts. `getAmmoRemaining(msKey, hpId)` gates the fire path.

import type { Entity } from 'koota'
import { Ms, EntityKey } from '../ecs/traits'
import { getWorld } from '../ecs/world'
import { sortieConfig } from '../config'
import { sortieStats } from './hangarDoors'

const SHIP_SCENE_ID = 'playerShipInterior'

function findMsByKey(msKey: string): Entity | null {
  if (!msKey) return null
  const w = getWorld(SHIP_SCENE_ID)
  for (const ent of w.query(Ms, EntityKey)) {
    if (ent.get(EntityKey)!.key === msKey) return ent
  }
  return null
}

// Drain propellant on the piloted MS by `axisMagnitude × propellantDrainPerThrustSec × dtSec`.
// Drain life support by `lifeSupportDrainPerSec × dtSec`. Returns the
// post-drain currentPropellant so callers can decide whether to zero
// the input axis this tick.
export function drainPilotedMs(
  pilotedMsKey: string, axisMagnitude: number, dtSec: number,
): { currentPropellant: number; currentLifeSupport: number } {
  const t0 = sortieStats.enabled ? performance.now() : 0
  const ent = findMsByKey(pilotedMsKey)
  if (!ent) return { currentPropellant: 0, currentLifeSupport: 0 }
  const m = ent.get(Ms)!
  const propDrain = sortieConfig.propellantDrainPerThrustSec * axisMagnitude * dtSec
  const lsDrain = sortieConfig.lifeSupportDrainPerSec * dtSec
  const nextProp = Math.max(0, m.currentPropellant - propDrain)
  const nextLs = Math.max(0, m.currentLifeSupport - lsDrain)
  if (nextProp !== m.currentPropellant || nextLs !== m.currentLifeSupport) {
    ent.set(Ms, { ...m, currentPropellant: nextProp, currentLifeSupport: nextLs })
  }
  if (sortieStats.enabled) sortieStats.drainTickMs += performance.now() - t0
  return { currentPropellant: nextProp, currentLifeSupport: nextLs }
}

// W3 (ms-identity) Task 3 — one-shot propellant debit for vernier boost, as
// opposed to drainPilotedMs's continuous per-dt drain under thrust. A boost
// either fully triggers or doesn't (no partial-charge boost) — returns false
// (no state mutated) when the pool can't cover `cost` in full, or the MS
// entity can't be found.
export function spendPropellant(msKey: string, cost: number): boolean {
  const ent = findMsByKey(msKey)
  if (!ent) return false
  const m = ent.get(Ms)!
  if (m.currentPropellant < cost) return false
  ent.set(Ms, { ...m, currentPropellant: m.currentPropellant - cost })
  return true
}

export function isMsStranded(msKey: string): boolean {
  const ent = findMsByKey(msKey)
  if (!ent) return false
  return ent.get(Ms)!.currentPropellant <= 0
}

// Returns the per-MS ammo remaining for a hardpoint. Infinity for
// energy weapons. Returns 0 if the MS / hardpoint isn't found.
export function getAmmoRemaining(msKey: string, hardpointId: string): number {
  const ent = findMsByKey(msKey)
  if (!ent) return 0
  const ammo = ent.get(Ms)!.currentAmmoByWeapon
  // Missing key (e.g. just-spawned MS pre-attachMsStatSheet seeding) →
  // treat as 0 to stay safe; production path always seeds it.
  return ammo[hardpointId] ?? 0
}

// Attempt to consume one shot from the per-MS ammo pool. Returns true
// if the shot is allowed (and ammo was decremented), false if depleted.
// Infinity-cap weapons (energy) never decrement and always return true.
export function tryConsumeAmmo(msKey: string, hardpointId: string): boolean {
  const ent = findMsByKey(msKey)
  if (!ent) return false
  const m = ent.get(Ms)!
  const cur = m.currentAmmoByWeapon[hardpointId] ?? 0
  if (cur === Infinity) return true
  if (cur <= 0) return false
  ent.set(Ms, {
    ...m,
    currentAmmoByWeapon: { ...m.currentAmmoByWeapon, [hardpointId]: cur - 1 },
  })
  return true
}
