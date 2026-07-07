// Phase 6.2.5.C — mid-combat resupply protocol.
//
// Per Design/sortie.md §Mid-combat resupply:
//
//   resupplyTime  =  baseResupplySec
//                     / hangarBoss.workPerformance
//                     / (1 + Σ mechanicCrewEfficiency at this bay)
//                     / resourceBoostMul
//
// At dock-cycle completion (hangarDoors.tickDoorsFrame surfaces a
// `previousState: 'docking'` completion), routeDockedMsToResupply()
// attaches a `ResupplyState` trait to the MS and seeds it with the
// formula-computed `secTotal`. tickResupply() counts it down in
// tactical-time and on hit-zero restores `currentPropellant` +
// `currentAmmoByWeapon` to their caps, pushes a combat-log line, and
// removes the trait so the MS becomes relaunchable.
//
// Resupply does NOT touch hull / armor — depot repair, slow, per-day
// throughput; already shipped at 6.2.B / fleet.md.
//
// No auto-pause on completion — Design/sortie.md is explicit: the player
// decides when to relaunch. Combat-log line only.

import type { Entity } from 'koota'
import {
  Ms, MsStatSheet, ResupplyState, EntityKey,
} from '../ecs/traits'
import { getWorld } from '../ecs/world'
import { hangarResupplyStatsFor } from '../ecs/crewRoles'
import { sortieConfig } from '../config'
import { getStat } from '../stats/sheet'
import { getMsClass } from '../data/ms'
import { ammoCapsForMs } from '../ecs/msEffects'
import { pushCombatLog } from './combatLog'
import { sortieStats } from './hangarDoors'

const SHIP_SCENE_ID = 'playerShipInterior'

// Compute the resupply time for a given MS at its host ship's bay. Reads:
//   hangarBoss.workPerfMul — the real workPerfMul of the ship's hangar boss
//     (the crew member stationed at the hangar bay), via ecs/crewRoles.ts.
//     Falls back to the sortie.json5 config placeholder when no boss aboard.
//   mechanicCrewEfficiency — real count of additional hangar-stationed
//     mechanic crew × mechanicCrewEfficiencyPerSlot.
//   resourceBoostMul       — the MS sheet's sortieResupplyMul (frame mods +
//     research stack into it).
//
// Completes W3.6 — the boss/crew placeholders are replaced with live crew
// stats. The MS's host ship is resolved by `storedOnShipKey`.
export function resupplyTimeForMs(msEnt: Entity): number {
  const m = msEnt.get(Ms)
  if (!m) return sortieConfig.baseResupplySec
  // ResourceBoostMul: per-MS frame-mod stacked multiplier.
  const sheet = msEnt.get(MsStatSheet)?.sheet
  const resourceBoostMul = sheet ? Math.max(0.01, getStat(sheet, 'sortieResupplyMul')) : 1
  const { bossPerf, mechanicCrewCount } = hangarResupplyStatsFor(m.storedOnShipKey)
  const safeBossPerf = Math.max(0.01, bossPerf)
  const crewEff = mechanicCrewCount * sortieConfig.mechanicCrewEfficiencyPerSlot
  return sortieConfig.baseResupplySec / safeBossPerf / (1 + crewEff) / resourceBoostMul
}

// Attach ResupplyState to a freshly-docked MS. Called from the dock
// cycle completion handler in combat.ts (after hangarDoors.tickDoorsFrame).
// Idempotent — if the MS already has ResupplyState, the call is a no-op.
export function routeDockedMsToResupply(
  msKey: string, shipKey: string, bayDoorId: string,
): boolean {
  const w = getWorld(SHIP_SCENE_ID)
  for (const ent of w.query(Ms, EntityKey)) {
    if (ent.get(EntityKey)!.key !== msKey) continue
    if (ent.has(ResupplyState)) return false
    const secTotal = resupplyTimeForMs(ent)
    ent.add(ResupplyState)
    ent.set(ResupplyState, {
      shipKey,
      bayDoorId,
      secRemaining: secTotal,
      secTotal,
    })
    pushCombatLog(`${ent.get(Ms)!.name} · 入舱补给 · ${Math.round(secTotal)} 秒`, 'info')
    return true
  }
  return false
}

// Per-tick resupply countdown. `dtTacSec` is the tactical-time delta
// since the last call. On hit-zero: write caps back onto the Ms trait,
// log completion, remove ResupplyState.
//
// Returns the list of MS keys that completed this tick (used by smoke
// tests to assert the timing).
export function tickResupply(dtTacSec: number): string[] {
  const w = getWorld(SHIP_SCENE_ID)
  const t0 = sortieStats.enabled ? performance.now() : 0
  const completed: string[] = []
  for (const ent of w.query(Ms, ResupplyState, EntityKey)) {
    const rs = ent.get(ResupplyState)!
    const next = Math.max(0, rs.secRemaining - dtTacSec)
    if (next > 0) {
      ent.set(ResupplyState, { ...rs, secRemaining: next })
      continue
    }
    // Complete.
    const m = ent.get(Ms)!
    const sheet = ent.get(MsStatSheet)?.sheet
    const propCap = sheet ? getStat(sheet, 'propellantStorage') : m.hullMax
    // Ammo cap is per-weapon template (not stat-driven) — rebuild from
    // current mountedWeapons so a mid-sortie weapon swap rebases the
    // cap correctly.
    const cls = getMsClass(m.templateId)
    const ammoCaps = ammoCapsForMs(cls, m.mountedWeapons)
    ent.set(Ms, {
      ...m,
      currentPropellant: propCap,
      currentAmmoByWeapon: ammoCaps,
      // Life support NOT restored — pilot still ticking; sortie.md is
      // explicit that only `eject + drift` touches the floor anyway.
    })
    pushCombatLog(`${m.name} · 补给完成 · 推进剂与弹药已满载`, 'info')
    ent.remove(ResupplyState)
    completed.push(ent.get(EntityKey)!.key)
  }
  if (sortieStats.enabled) sortieStats.resupplyTickMs += performance.now() - t0
  return completed
}
