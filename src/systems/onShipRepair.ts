// W4.3 (completes W1.5) — on-ship forward MS repair band. The ship's hangar
// crew patch MS riding aboard the flagship between engagements, but only
// within the band `[onShipRepairFloor, onShipRepairCap]` — ship stats read
// via `getStat(shipSheet, …)` (declared in stats/shipSchema.ts, until now
// read nowhere). The asymmetry vs. a depot (systems/hangarRepair.ts, which
// restores to 100%) is the structural reason surface hangars stay relevant:
//
//   - An aboard MS whose integrity is BELOW the floor is sidelined —
//     untouchable aboard; it must be depoted for deep structural work.
//   - An aboard MS within the band is patched armor-first then hull, but each
//     field rises only to `cap × max` — never to 100% aboard.
//
// Aboard = `Ms.storedOnShipKey === flagshipKey` AND `Ms.dockedAtPoiId === ''`
// (the custody invariant: a depoted MS carries dockedAtPoiId and is repaired
// by hangarRepair.ts instead). `damageState` is only ever routed through
// `computeMsDamageState` — an aboard MS (no dockedAtPoiId) stays 'ready'
// with deficit, never 'in-repair'.
//
// Perf (CLAUDE.md budget): O(aboard-MS) per repair tick; N ≤ the hull's
// hangarCapacity (single digits). Runs on the daily repair chain alongside
// hangarRepairSystem — no per-frame cost.

import type { Entity } from 'koota'
import { Ms, Ship, ShipStatSheet, EntityKey } from '../ecs/traits'
import { getWorld } from '../ecs/world'
import { getStat } from '../stats/sheet'
import { computeMsDamageState } from '../ecs/msDamage'
import { sortieConfig } from '../config'

const SHIP_SCENE_ID = 'playerShipInterior'

export interface OnShipRepairResult {
  // MS that received repair points this call (progressed toward the cap).
  msRepaired: number
  // MS sidelined below the floor — untouchable aboard this call.
  msRefused: number
  pointsApplied: number
}

interface MsRepairFields {
  hullCurrent: number
  hullMax: number
  armorCurrent: number
  armorMax: number
}

function msIntegrity(m: MsRepairFields): number {
  const total = m.hullMax + m.armorMax
  return total > 0 ? (m.hullCurrent + m.armorCurrent) / total : 1
}

// Repair room left within the band ceiling (cap × max) on either field.
function bandDeficit(m: MsRepairFields, cap: number): number {
  const armorRoom = Math.max(0, m.armorMax * cap - m.armorCurrent)
  const hullRoom = Math.max(0, m.hullMax * cap - m.hullCurrent)
  return armorRoom + hullRoom
}

// Apply `points` armor-first then hull, each field clamped to `cap × max`.
// Never lowers a field (a field already above its ceiling is left untouched).
function applyBandedRepair(
  m: MsRepairFields, points: number, cap: number,
): { armorCurrent: number; hullCurrent: number; applied: number } {
  const armorCeil = m.armorMax * cap
  const hullCeil = m.hullMax * cap
  let remaining = points
  let nextArmor = m.armorCurrent
  let nextHull = m.hullCurrent
  if (nextArmor < armorCeil) {
    const give = Math.min(armorCeil - nextArmor, remaining)
    nextArmor += give
    remaining -= give
  }
  if (remaining > 0 && nextHull < hullCeil) {
    const give = Math.min(hullCeil - nextHull, remaining)
    nextHull += give
    remaining -= give
  }
  return { armorCurrent: nextArmor, hullCurrent: nextHull, applied: points - remaining }
}

function aboardMsFor(flagshipKey: string): Entity[] {
  const shipWorld = getWorld(SHIP_SCENE_ID)
  const out: Entity[] = []
  for (const ent of shipWorld.query(Ms)) {
    const m = ent.get(Ms)!
    if (m.storedOnShipKey !== flagshipKey || m.dockedAtPoiId !== '') continue
    out.push(ent)
  }
  return out
}

function applyToMs(ent: Entity, points: number, cap: number, result: OnShipRepairResult): void {
  const m = ent.get(Ms)
  if (!m) return
  const { armorCurrent, hullCurrent, applied } = applyBandedRepair(m, points, cap)
  if (applied <= 0) return
  const updated = { ...m, armorCurrent, hullCurrent }
  ent.set(Ms, { ...updated, damageState: computeMsDamageState(updated) })
  result.pointsApplied += applied
  result.msRepaired += 1
}

// Repair the aboard MS of `ship` one tick within its forward-repair band.
// `opts.focusKey` — the Task 5 forward-repair-priority target: when set and
// aboard-repairable, the full pool focuses on that one MS; otherwise the pool
// spreads evenly across every repairable aboard MS.
export function runOnShipRepair(ship: Entity, opts: { focusKey?: string } = {}): OnShipRepairResult {
  const result: OnShipRepairResult = { msRepaired: 0, msRefused: 0, pointsApplied: 0 }
  const s = ship.get(Ship)
  const ss = ship.get(ShipStatSheet)
  const flagshipKey = ship.get(EntityKey)?.key ?? ''
  if (!s || !ss || !flagshipKey) return result

  const cap = getStat(ss.sheet, 'onShipRepairCap')
  const floor = getStat(ss.sheet, 'onShipRepairFloor')
  if (cap <= 0) return result

  const repairable: Entity[] = []
  for (const ent of aboardMsFor(flagshipKey)) {
    const m = ent.get(Ms)!
    if (msIntegrity(m) < floor) { result.msRefused += 1; continue }
    if (bandDeficit(m, cap) <= 0) continue
    repairable.push(ent)
  }
  if (repairable.length === 0) return result

  const rate = sortieConfig.onShipRepair.pointsPerDay
  // Priority: an explicit opts.focusKey wins; otherwise honor the ship's
  // forward-repair-priority set from the hangar-deck panel (W4.3b).
  const focusKey = opts.focusKey ?? s.onShipRepairPriorityKey
  const focus = focusKey
    ? repairable.find((e) => e.get(EntityKey)?.key === focusKey) ?? null
    : null
  if (focus) {
    applyToMs(focus, rate, cap, result)
  } else {
    const share = rate / repairable.length
    for (const ent of repairable) applyToMs(ent, share, cap, result)
  }
  return result
}

export interface OnShipRepairAboardMs {
  key: string
  name: string
  hullPct: number
  armorPct: number
  integrity: number
  // Sidelined: below the floor, untouchable aboard until depoted.
  belowFloor: boolean
  // Fully patched to the aboard ceiling — needs a depot for the rest.
  atCap: boolean
}

export interface OnShipRepairView {
  cap: number
  floor: number
  aboard: OnShipRepairAboardMs[]
}

// Read model for the Task 5 hangar-deck panel: the band + every aboard MS's
// state relative to it.
export function describeOnShipRepair(ship: Entity): OnShipRepairView {
  const ss = ship.get(ShipStatSheet)
  const flagshipKey = ship.get(EntityKey)?.key ?? ''
  const cap = ss ? getStat(ss.sheet, 'onShipRepairCap') : 0
  const floor = ss ? getStat(ss.sheet, 'onShipRepairFloor') : 0
  const aboard: OnShipRepairAboardMs[] = []
  if (flagshipKey) {
    for (const ent of aboardMsFor(flagshipKey)) {
      const m = ent.get(Ms)!
      const integrity = msIntegrity(m)
      aboard.push({
        key: ent.get(EntityKey)?.key ?? '',
        name: m.name,
        hullPct: m.hullMax > 0 ? m.hullCurrent / m.hullMax : 1,
        armorPct: m.armorMax > 0 ? m.armorCurrent / m.armorMax : 1,
        integrity,
        belowFloor: integrity < floor,
        atCap: bandDeficit(m, cap) <= 0,
      })
    }
  }
  return { cap, floor, aboard }
}
