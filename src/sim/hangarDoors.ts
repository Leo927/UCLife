// Phase 6.2.5.C — per-ship hangar-door state machine.
//
// Each authored door cycles `idle → launching → idle → docking → idle`
// and locks for sortieConfig.launchDoorLockSec / dockDoorLockSec
// tactical-seconds. Door count may be less than hangarCapacity → MS share
// doors via per-door FIFO queues.
//
// All state lives on the parent ship entity via the HangarDoorStates
// trait (one record per door id). No per-door entity; resupply +
// recovery-tug systems look up door state through the ship's entity.
//
// Per CLAUDE.md perf budget: O(D) per frame where D ≤ Σ hangarDoors
// (≈3 doors per pegasusClass × 3 carriers = 9 in a realistic upper
// bound). Each door tick is a small struct update; the loop is
// trivially under the 0.05 ms/frame budget.

import type { Entity } from 'koota'
import {
  Ship, EntityKey, HangarDoorStates, Ms, type DoorState,
} from '../ecs/traits'
import { getWorld } from '../ecs/world'
import { getShipClass } from '../data/ship-classes'
import type { ShipHangarDoorDef } from '../data/ship-classes'
import { sortieConfig } from '../config'

const SHIP_SCENE_ID = 'playerShipInterior'

// Module-level profiling counters. Mirrors `hpaStats` (src/systems/hpa.ts
// lines 116–134): flip `sortieStats.enabled = true` from devtools to
// capture per-tick / per-frame timing. Negligible overhead when off.
export const sortieStats = {
  enabled: false,
  doorFrameMs: 0,
  resupplyTickMs: 0,
  drainTickMs: 0,
  tugTickMs: 0,
  // Lifetime counts (cumulative) so the smoke can assert at least N
  // door cycles have run after a launch / dock pair.
  launchCycles: 0,
  dockCycles: 0,
}

function ensureDoorStates(shipEnt: Entity): Record<string, DoorState> {
  if (!shipEnt.has(HangarDoorStates)) {
    shipEnt.add(HangarDoorStates)
  }
  const cur = shipEnt.get(HangarDoorStates)!
  const cls = getShipClass(shipEnt.get(Ship)!.templateId)
  const authored = cls.hangarDoors ?? []
  // Seed missing per-door entries idempotently. Keep existing records
  // untouched (in-flight lock + queue must survive the ensure call).
  const next: Record<string, DoorState> = { ...cur.byDoorId }
  for (const d of authored) {
    if (!next[d.id]) {
      next[d.id] = {
        state: 'idle',
        lockSec: 0,
        queue: [],
        occupiedByMsKey: '',
      }
    }
  }
  if (Object.keys(next).length !== Object.keys(cur.byDoorId).length) {
    shipEnt.set(HangarDoorStates, { byDoorId: next })
  }
  return next
}

export function getDoorSnapshot(shipKey: string): Array<{
  doorId: string
  state: DoorState['state']
  lockSec: number
  queueLen: number
  occupiedByMsKey: string
}> {
  const ent = findShipByKey(shipKey)
  if (!ent) return []
  const states = ensureDoorStates(ent)
  return Object.entries(states).map(([doorId, st]) => ({
    doorId,
    state: st.state,
    lockSec: st.lockSec,
    queueLen: st.queue.length,
    occupiedByMsKey: st.occupiedByMsKey,
  }))
}

function findShipByKey(shipKey: string): Entity | null {
  const w = getWorld(SHIP_SCENE_ID)
  for (const ent of w.query(Ship, EntityKey)) {
    if (ent.get(EntityKey)!.key === shipKey) return ent
  }
  return null
}

// Pick the next free door bound to a free bay for a launching MS. Doors
// in `idle` state win immediately; otherwise the MS joins the shortest
// queue. Returns null if the ship has no authored hangar doors at all.
export function pickDoorForLaunch(shipKey: string): { doorId: string; door: ShipHangarDoorDef } | null {
  const ent = findShipByKey(shipKey)
  if (!ent) return null
  const cls = getShipClass(ent.get(Ship)!.templateId)
  const doors = cls.hangarDoors ?? []
  if (doors.length === 0) return null
  const states = ensureDoorStates(ent)
  // Prefer an idle, unoccupied door first.
  for (const d of doors) {
    const st = states[d.id]
    if (st.state === 'idle' && st.lockSec === 0 && st.occupiedByMsKey === '' && st.queue.length === 0) {
      return { doorId: d.id, door: d }
    }
  }
  // Fall back to the shortest queue (deterministic — first by authoring
  // order on ties).
  let best: { doorId: string; door: ShipHangarDoorDef; q: number } | null = null
  for (const d of doors) {
    const q = states[d.id].queue.length
    if (best === null || q < best.q) best = { doorId: d.id, door: d, q }
  }
  return best ? { doorId: best.doorId, door: best.door } : null
}

// Request a launch through the picked door. If the door is idle, fire
// the cycle immediately and return `{ ok:true, immediate:true }`. If
// the door is busy or queued, enqueue and return `immediate:false`.
// `msKey` is the MS entity key being launched.
export function requestLaunch(
  shipKey: string, msKey: string, doorId: string,
): { ok: true; immediate: boolean } | { ok: false; reasonZh: string } {
  const ent = findShipByKey(shipKey)
  if (!ent) return { ok: false, reasonZh: '舰体不存在' }
  const states = ensureDoorStates(ent)
  const st = states[doorId]
  if (!st) return { ok: false, reasonZh: `舱门 ${doorId} 未授权` }
  if (st.state === 'idle' && st.occupiedByMsKey === '') {
    // Fire immediately.
    const nextStates = {
      ...states,
      [doorId]: {
        state: 'launching' as const,
        lockSec: sortieConfig.launchDoorLockSec,
        queue: [...st.queue],
        occupiedByMsKey: msKey,
      },
    }
    ent.set(HangarDoorStates, { byDoorId: nextStates })
    sortieStats.launchCycles += 1
    return { ok: true, immediate: true }
  }
  // Enqueue.
  if (st.queue.includes(msKey)) return { ok: true, immediate: false }
  const nextStates = {
    ...states,
    [doorId]: { ...st, queue: [...st.queue, msKey] },
  }
  ent.set(HangarDoorStates, { byDoorId: nextStates })
  return { ok: true, immediate: false }
}

// Request a dock at the picked door — mirror shape of requestLaunch.
// In immediate-ok case, kicks off the docking cycle.
export function requestDock(
  shipKey: string, msKey: string, doorId: string,
): { ok: true; immediate: boolean } | { ok: false; reasonZh: string } {
  const ent = findShipByKey(shipKey)
  if (!ent) return { ok: false, reasonZh: '舰体不存在' }
  const states = ensureDoorStates(ent)
  const st = states[doorId]
  if (!st) return { ok: false, reasonZh: `舱门 ${doorId} 未授权` }
  if (st.state === 'idle' && st.occupiedByMsKey === '') {
    const nextStates = {
      ...states,
      [doorId]: {
        state: 'docking' as const,
        lockSec: sortieConfig.dockDoorLockSec,
        queue: [...st.queue],
        occupiedByMsKey: msKey,
      },
    }
    ent.set(HangarDoorStates, { byDoorId: nextStates })
    sortieStats.dockCycles += 1
    return { ok: true, immediate: true }
  }
  if (st.queue.includes(msKey)) return { ok: true, immediate: false }
  const nextStates = {
    ...states,
    [doorId]: { ...st, queue: [...st.queue, msKey] },
  }
  ent.set(HangarDoorStates, { byDoorId: nextStates })
  return { ok: true, immediate: false }
}

// Tick every door on every ship. Counts down `lockSec`; on hitting 0,
// flips state back to 'idle', releases `occupiedByMsKey`, and pops the
// next queued MS into the appropriate cycle (FIFO).
//
// `cycleCompletions` is filled with `{ shipKey, doorId, finishedMsKey,
// previousState }` so callers can dispatch follow-ups (e.g. routing a
// completed-dock MS into the resupply queue).
export interface DoorCycleCompletion {
  shipKey: string
  doorId: string
  finishedMsKey: string
  previousState: 'launching' | 'docking'
}

export function tickDoorsFrame(dtTacSec: number): DoorCycleCompletion[] {
  const w = getWorld(SHIP_SCENE_ID)
  const t0 = sortieStats.enabled ? performance.now() : 0
  const completions: DoorCycleCompletion[] = []
  for (const shipEnt of w.query(Ship, HangarDoorStates, EntityKey)) {
    const states = shipEnt.get(HangarDoorStates)!.byDoorId
    const shipKey = shipEnt.get(EntityKey)!.key
    let mutated = false
    const next: Record<string, DoorState> = { ...states }
    for (const [doorId, st] of Object.entries(states)) {
      if (st.state === 'idle') continue
      const newLock = Math.max(0, st.lockSec - dtTacSec)
      if (newLock > 0) {
        next[doorId] = { ...st, lockSec: newLock }
        mutated = true
        continue
      }
      // Cycle complete.
      completions.push({
        shipKey,
        doorId,
        finishedMsKey: st.occupiedByMsKey,
        previousState: st.state,
      })
      // Pop next queued MS, if any. Assume the queued MS uses the same
      // pending operation as the door's current state — launches and
      // docks share a queue here for simplicity; if the future ever
      // needs separate queues, split DoorState by op.
      const queue = [...st.queue]
      const nextMsKey = queue.shift() ?? ''
      if (nextMsKey === '') {
        next[doorId] = {
          state: 'idle',
          lockSec: 0,
          queue: [],
          occupiedByMsKey: '',
        }
      } else {
        // Re-arm the same operation for the next queued MS.
        next[doorId] = {
          state: st.state,
          lockSec: st.state === 'launching'
            ? sortieConfig.launchDoorLockSec
            : sortieConfig.dockDoorLockSec,
          queue,
          occupiedByMsKey: nextMsKey,
        }
        if (st.state === 'launching') sortieStats.launchCycles += 1
        else sortieStats.dockCycles += 1
      }
      mutated = true
    }
    if (mutated) shipEnt.set(HangarDoorStates, { byDoorId: next })
  }
  if (sortieStats.enabled) sortieStats.doorFrameMs += performance.now() - t0
  return completions
}

// Free a tug-occupied door. Called when the recovery tug despawns at
// handoff. The door's state stays whatever it was (likely 'idle' since
// tugs don't enter the launching / docking cycle) but `occupiedByMsKey`
// must clear so future launches succeed.
export function releaseDoorOccupant(shipKey: string, doorId: string): void {
  const ent = findShipByKey(shipKey)
  if (!ent) return
  const states = ensureDoorStates(ent)
  const st = states[doorId]
  if (!st || st.occupiedByMsKey === '') return
  const nextStates = { ...states, [doorId]: { ...st, occupiedByMsKey: '' } }
  ent.set(HangarDoorStates, { byDoorId: nextStates })
}

// Reserve a door for a tug. Sets `occupiedByMsKey` to the tug's key so
// launches refuse it for the duration; door state stays 'idle' so the
// cycle counters stay accurate.
export function reserveDoorForTug(
  shipKey: string, doorId: string, tugKey: string,
): boolean {
  const ent = findShipByKey(shipKey)
  if (!ent) return false
  const states = ensureDoorStates(ent)
  const st = states[doorId]
  if (!st) return false
  if (st.state !== 'idle' || st.occupiedByMsKey !== '') return false
  const nextStates = { ...states, [doorId]: { ...st, occupiedByMsKey: tugKey } }
  ent.set(HangarDoorStates, { byDoorId: nextStates })
  return true
}

// World-space launch geometry for a door: `(ship.pos + door.position
// rotated by ship.heading)` with initial velocity along
// `(door.facing + ship.heading)` × speed. Reused at launchMs in cockpit.ts
// and at tug-completion handoff. Caller passes `shipPos` / `shipHeading`
// (taken from the parent ship's CombatShipState) and a launch speed.
export function launchPointAndVelocity(
  door: ShipHangarDoorDef,
  shipPos: { x: number; y: number },
  shipHeading: number,
  speed: number,
): { pos: { x: number; y: number }; vel: { x: number; y: number } } {
  const cosH = Math.cos(shipHeading)
  const sinH = Math.sin(shipHeading)
  const px = shipPos.x + door.position.x * cosH - door.position.y * sinH
  const py = shipPos.y + door.position.x * sinH + door.position.y * cosH
  const totalFacing = shipHeading + (door.facing * Math.PI) / 180
  return {
    pos: { x: px, y: py },
    vel: { x: Math.cos(totalFacing) * speed, y: Math.sin(totalFacing) * speed },
  }
}

// Find which ship is hosting a given Ms entity (via storedOnShipKey).
// Returns the ship's EntityKey or '' if not stored.
export function findHostShipKeyForMs(msKey: string): string {
  const w = getWorld(SHIP_SCENE_ID)
  for (const ent of w.query(Ms, EntityKey)) {
    if (ent.get(EntityKey)!.key !== msKey) continue
    return ent.get(Ms)!.storedOnShipKey
  }
  return ''
}
