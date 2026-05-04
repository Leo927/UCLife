// Save handler registry. Lets each subsystem own its own snapshot /
// restore / reset triple instead of save/index.ts importing from every
// system. Adding a 16th persisted subsystem == one new file in
// src/boot/saveHandlers/, with no edit to save/index.ts.
//
// Why two phases? loadGame has a hard ordering split: a few things must
// run *before* entity restore (active scene id — `world` proxy resolves
// to the active scene, so byKey lookup needs the right world), and most
// things must run *after* (so the entities they reference exist).
// Three+ phases would be premature; two captures every current case.
//
// Why not register from inside the subsystem files (e.g. systems/
// population.ts)? Tree-shaking. A handler co-located with the subsystem
// only registers if some other module imports the subsystem first —
// fragile. Putting handlers in boot/saveHandlers/ and side-effect-
// importing them from main.tsx makes the registration set explicit and
// reviewable in one place.

export type SavePhase = 'pre' | 'post'

export interface SaveHandler<T = unknown> {
  /**
   * Stable bundle key. Renaming requires a version bump + migration —
   * old saves written with the previous id won't be found by restore.
   */
  readonly id: string

  /**
   * 'pre'  : runs after resetWorld(), before entity overlay. Reserved
   *          for state the entity overlay depends on (active scene id).
   * 'post' (default) : runs after entities + relations are in place.
   */
  readonly phase?: SavePhase

  /**
   * Produce a JSON-serializable blob (superjson handles Date / Map).
   * Return undefined to skip writing — used for transient subsystems
   * that only need reset() on load.
   */
  snapshot(): T | undefined

  /**
   * Apply a blob from the bundle. Called only when the bundle has a
   * value at this handler's id. Throw to fail the load.
   */
  restore(blob: T): void

  /**
   * Called when the bundle has no value at this handler's id (legacy
   * save predates the subsystem, or the subsystem is transient and
   * never persists). Default: no-op.
   */
  reset?(): void
}

const handlers = new Map<string, SaveHandler>()

export function registerSaveHandler<T>(handler: SaveHandler<T>): void {
  if (handlers.has(handler.id)) {
    throw new Error(`Duplicate save handler id: ${handler.id}`)
  }
  handlers.set(handler.id, handler as SaveHandler)
}

/** Test-only: clear the registry. Production code never calls this. */
export function __resetSaveHandlersForTests(): void {
  handlers.clear()
}

export function snapshotAll(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [id, h] of handlers) {
    const v = h.snapshot()
    if (v !== undefined) out[id] = v
  }
  return out
}

export function restoreAll(
  bundle: Record<string, unknown> | undefined,
  phase: SavePhase,
): void {
  const blobs = bundle ?? {}
  for (const [id, h] of handlers) {
    if ((h.phase ?? 'post') !== phase) continue
    if (id in blobs) h.restore(blobs[id])
    else h.reset?.()
  }
}

// Calls reset() on every registered handler. Used by the world-reset
// lifecycle (ecs/spawn.ts :: resetWorld), not by load. Order is
// registration order; handler reset() functions must be independent.
export function resetAll(): void {
  for (const [, h] of handlers) h.reset?.()
}
