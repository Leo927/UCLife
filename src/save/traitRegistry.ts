// Per-trait save registry. Inverts what save/index.ts used to do —
// instead of a hard-coded list of `if (entity.has(Position)) snap.position = ...`
// branches in snapshotEntity, each trait registers a `(read, write)` pair
// here once at boot. snapshotEntity becomes a generic loop over the
// registered serializers; adding a new persisted trait == one new file
// in src/boot/traitSerializers/, with no edit to save/index.ts.
//
// Why side-effect registration in boot/, not co-located with each system?
// Same reasoning as src/save/registry.ts (subsystem handlers): tree-
// shaking. A serializer co-located with a system module would only
// register if some other module imports that system first. Putting them
// in boot/traitSerializers/ + side-effect importing the manifest from
// main.tsx makes the registration set explicit and reviewable in one
// place.
//
// The on-disk EntitySnap shape is preserved exactly: each serializer's
// `id` matches the field name save/index.ts used to set on the snap, so
// previously-written bundles round-trip through the registry without a
// SAVE_VERSION bump.

import type { Entity, Trait } from 'koota'

// ── Context handed to read/write ────────────────────────────────────────

export interface SerializeCtx {
  /** Resolve an entity reference to its stable EntityKey, or null if absent. */
  keyOf(e: Entity | null): string | null
}

export interface RestoreCtx {
  /** Resolve a saved EntityKey back to a live entity, null if dangling. */
  resolveRef(key: string | null): Entity | null
  /** Save bundle version, for migrations inside write(). */
  version: number
}

// ── Serializer interface ────────────────────────────────────────────────

export interface TraitSerializer<T = unknown> {
  /** Stable id used as the field name in the on-disk EntitySnap. */
  readonly id: string
  /** koota trait reference; presence of this trait gates `read`. */
  readonly trait: Trait
  /**
   * Produce a JSON-serializable snapshot of the trait, or undefined to
   * skip. Called only when entity.has(trait).
   */
  read(entity: Entity, ctx: SerializeCtx): T | undefined
  /**
   * Apply a snapshot value to the entity. Implementation chooses set vs
   * add vs in-place patch as appropriate for the trait's lifecycle
   * (see Bed/BarSeat for in-place patching of static-field-bearing
   * traits, Home/Ambitions/etc. for add-or-set on optional traits).
   */
  write(entity: Entity, value: T, ctx: RestoreCtx): void
  /**
   * Called when the snapshot has no value at this serializer's id. Used
   * by traits that get added at runtime (Home, PendingEviction, etc.) so
   * a load from a save where the trait was absent removes any stale copy
   * left by setupWorld(). Default: no-op (safe for traits that always
   * exist post-setupWorld, like Position / Vitals / Attributes).
   */
  reset?(entity: Entity): void
}

const serializers: TraitSerializer[] = []

export function registerTraitSerializer<T>(s: TraitSerializer<T>): void {
  if (serializers.some((x) => x.id === s.id)) {
    throw new Error(`Duplicate trait serializer id: ${s.id}`)
  }
  serializers.push(s as TraitSerializer)
}

export function getTraitSerializers(): readonly TraitSerializer[] {
  return serializers
}

/** Test-only: clear the registry. Production code never calls this. */
export function __resetTraitSerializersForTests(): void {
  serializers.length = 0
}
