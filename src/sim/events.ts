// Tiny synchronous pub/sub for cross-cutting sim signals — keeps `sim/`
// from depending on `save/` and vice versa. Handlers are invoked in the
// emitter's call frame so semantics match the old direct-call shape
// (e.g. emit('load:start') stops the loop before the next line runs).
//
// Why not zustand? Events are not state — there's no "current value" to
// subscribe to. A plain Set of listeners is simpler and avoids dragging
// React-flavored reactivity into the sim layer.
//
// Why not a third-party emitter (mitt, eventemitter3)? ~30 LOC isn't
// worth a dep. If the surface grows past trivial we can revisit.

export type SimEventName =
  | 'day:rollover'      // emitted when a tick crosses midnight
  | 'hyperspeed:start'  // emitted on the leading edge of committed hyperspeed
  | 'load:start'        // emitted by save/loadGame before mutating world state
  | 'load:end'          // emitted by save/loadGame after world is consistent

export interface SimEvent {
  /** Human-readable label for telemetry / autosave toast labels. */
  reason: string
}

const listeners = new Map<SimEventName, Set<(ev: SimEvent) => void>>()

export function onSim(name: SimEventName, fn: (ev: SimEvent) => void): () => void {
  let set = listeners.get(name)
  if (!set) {
    set = new Set()
    listeners.set(name, set)
  }
  set.add(fn)
  return () => { set!.delete(fn) }
}

export function emitSim(name: SimEventName, reason = ''): void {
  const set = listeners.get(name)
  if (!set || set.size === 0) return
  for (const fn of set) fn({ reason })
}
