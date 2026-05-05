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
  'hyperspeed:start':   { reason: string }
  'load:start':         { reason: string }
  'load:end':           { reason: string }
  // ── Generic event-log + toast ────────────────────────────────────────
  'log':                { textZh: string; atMs: number }
  'toast':              { textZh: string; durationMs?: number; action?: { label: string; onClick: () => void } }
  // ── Edge-triggered sim facts the UI subscribes to ────────────────────
  'ambitions:slot-empty': Record<string, never>
  // ── Semantic UI intents (no other way for sim to express these) ──────
  'ui:open-shop':              Record<string, never>
  'ui:open-clinic':            Record<string, never>
  'ui:open-flight':            { hubId: string }
  'ui:open-transit':           { terminalId: string }
  'ui:open-dialog-npc':        { entity: Entity }
  'ui:open-ship-dealer':       Record<string, never>
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
