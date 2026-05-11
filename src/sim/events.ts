// Tiny synchronous pub/sub for cross-cutting sim signals — keeps `sim/`
// from depending on `save/` and `ui/` (and vice versa). Handlers are
// invoked in the emitter's call frame so semantics match the old direct-
// call shape (e.g. emit('load:start') stops the loop before the next line
// runs; emit('toast') flushes to zustand inside the same tick).
//
// Why typed payloads? Each event name carries a different shape; a single
// `{ reason: string }` only fit the lifecycle quartet. Sim-side callers
// emit facts (a log line, a slot becoming empty, a hub being selected),
// boot/uiBindings.ts owns the translation into store calls. That keeps
// presentation decisions out of sim and lets the sim run headless.
//
// Why not a third-party emitter (mitt, eventemitter3)? ~30 LOC isn't
// worth a dep.

import type { Entity } from 'koota'

export interface SimEventPayloads {
  // ── Lifecycle (legacy callers — `reason` only) ───────────────────────
  'day:rollover':       { reason: string }
  // Phase 5.5.6 — fired after the day:rollover system chain settles
  // (dailyEconomics, housingPressure, recruitment). Late subscribers
  // (research, future faction-AI) hook to this so they read post-
  // rollup state. `gameDay` is the integer day number AFTER the flip.
  'day:rollover:settled': { gameDay: number }
  'hyperspeed:start':   { reason: string }
  // Phase 5.5.2 — surface from outside the loop. The loop's per-frame
  // hyperspeed gate reads `pendingHyperspeedBreak` set by this event and
  // forces isHyperspeed=false for one frame.
  'hyperspeed:break':   { reason: string }
  'load:start':         { reason: string }
  'load:end':           { reason: string }
  // ── Generic event-log + toast ────────────────────────────────────────
  'log':                { textZh: string; atMs: number }
  'toast':              { textZh: string; durationMs?: number; action?: { label: string; onClick: () => void } }
  // ── Semantic UI intents (no other way for sim to express these) ──────
  'ui:open-flight':            { hubId: string }
  'ui:open-transit':           { terminalId: string }
  'ui:open-dialog-npc':        { entity: Entity }
  'ui:open-manage':            { building: Entity }
  'ui:open-captains-office':   { reason: string }
  // Phase 6.2 — captain's-office comm-panel kiosk: officer face wall
  // + named-POW intel reveal. Per-prisoner verbs land at 6.2.5; the
  // panel today is read-only.
  'ui:open-comm-panel':        { reason: string }
  // Phase 6.2 — brig walk-up kiosk: occupant list, capacity gauge.
  // Per-prisoner verbs land at 6.2.5.
  'ui:open-brig-panel':        { reason: string }
  // Phase 6.1 — set the tactical-overlay visibility (combat may keep
  // running underneath while the overlay is hidden, so the player can
  // walk the ship interior mid-engagement). Subscribed by combat.ts to
  // mutate useCombatStore.open without an upward import from sim/.
  'combat:set-overlay-open': { open: boolean }
  // Phase 6.0 (left-panel loot) + Phase 6.2 (right-panel captures).
  // Fires when tactical resolves in the player's favor; the combat
  // tally panel listens.
  'ui:open-combat-tally':      {
    creditsDelta: number
    creditsAfter: number
    suppliesDelta: number
    suppliesAfter: number
    suppliesMax: number
    fuelDelta: number
    fuelAfter: number
    fuelMax: number
    // Phase 6.2 — named POWs captured this engagement. Empty when no
    // named hostile died with brig capacity. Anonymous crew captures
    // are out-of-scope at 6.2 (no recoverables dialogue yet); the
    // captured panel hides when this is empty.
    capturedPows: {
      id: string
      nameZh: string
      titleZh?: string
      contextZh: string
    }[]
    // Brig occupancy line shown beneath the captured list. Always set
    // so the panel can render "Brig: N / M" even with zero captures
    // (the player may have prior POWs aboard).
    brigOccupied: number
    brigCapacity: number
  }
}

export type SimEventName = keyof SimEventPayloads

type Listener<N extends SimEventName> = (payload: SimEventPayloads[N]) => void

const listeners = new Map<SimEventName, Set<(payload: unknown) => void>>()

export function onSim<N extends SimEventName>(name: N, fn: Listener<N>): () => void {
  let set = listeners.get(name)
  if (!set) {
    set = new Set()
    listeners.set(name, set)
  }
  const wrapped = fn as (payload: unknown) => void
  set.add(wrapped)
  return () => { set!.delete(wrapped) }
}

export function emitSim<N extends SimEventName>(name: N, payload: SimEventPayloads[N]): void {
  const set = listeners.get(name)
  if (!set || set.size === 0) return
  for (const fn of set) fn(payload)
}
