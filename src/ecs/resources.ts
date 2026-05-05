// Per-world singleton resources.
//
// Several systems carry transient bookkeeping (NPC scheduling buckets,
// activeZone tick gate, vitals/stress inactive accumulators, population
// counters, relations log/decay/iso caches). Holding that state at module
// scope is unsafe under multi-world: koota entity ids are world-stamped,
// so a Map<Entity, T> populated against one scene's world will mis-match
// (collide on numeric id) with another scene's entities. The hazard is
// dormant today only because just one world is ticked at a time and we
// never directly reach into a non-active world's bookkeeping; but cross-
// scene entity-id collisions in the cached Maps would silently corrupt
// the moment that ever changed (or the moment a system reset that should
// have wiped one scene's state forgets to).
//
// The fix is to keep that state on a per-world singleton entity. Each
// system owns its own resource trait (so logic + data stay co-located)
// and reads/mutates it via `worldSingleton(world)`. The singleton entity
// is allocated lazily on first read; `bootstrapWorldSingleton(world)` is
// called from `setupWorld()` so all per-world traits attach before any
// system ticks.
//
// Per-active-scene and player-global state stays in module scope; see
// inline invariant comments in `combat.ts`, `spaceSim.ts`, `supplyDrain.ts`,
// and `promotion.ts`.

import { trait } from 'koota'
import type { Entity, World } from 'koota'

// Marker trait for the per-world singleton entity. No payload — concrete
// per-system state lives in separate traits attached to the same entity.
export const WorldSingleton = trait()

const singletonByWorld = new WeakMap<World, Entity>()

// Allocates the singleton if missing. Cached against the World reference
// so the lookup cost is O(1) after the first call per world.
export function worldSingleton(world: World): Entity {
  const cached = singletonByWorld.get(world)
  if (cached !== undefined) {
    // koota's queryFirst is the source of truth — cached entry can be
    // stale across world.reset() (which destroys all entities). When the
    // marker has gone, allocate a fresh one and re-cache.
    if (cached.has(WorldSingleton)) return cached
  }
  let e = world.queryFirst(WorldSingleton)
  if (!e) e = world.spawn(WorldSingleton)
  singletonByWorld.set(world, e)
  return e
}

// Idempotent — safe to call once per world during scene bootstrap. The
// allocation itself is what matters; per-system traits attach lazily on
// first read.
export function bootstrapWorldSingleton(world: World): void {
  worldSingleton(world)
}
