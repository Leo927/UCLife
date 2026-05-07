// Phase 5.5 ownership layer. Two responsibilities right now:
//   1. Bootstrap a Faction entity per FactionId in each scene world so
//      Owner.entity has a stable target to reference.
//   2. Resolve the default Owner for a building type at spawn time.
//
// Future phases hang revenue / payroll / insolvency systems off this same
// trait pair. 5.5.0 ships only the data plumbing.

import type { Entity, World, TraitInstance } from 'koota'
import { Faction, EntityKey, Owner } from './traits'
import { factionsConfig, ownershipConfig, type FactionId } from '../config'

export const FACTION_KEY_PREFIX = 'faction-'

export function factionKey(id: FactionId): string {
  return `${FACTION_KEY_PREFIX}${id}`
}

// Spawn one Faction entity per FactionId in `world`. Idempotent — calling
// twice on the same world is a no-op (queries the existing set first).
// Called from each city-scene bootstrap before any Building spawns.
export function bootstrapFactions(world: World): void {
  const existing = new Set<FactionId>()
  for (const e of world.query(Faction)) {
    existing.add(e.get(Faction)!.id)
  }
  for (const id of Object.keys(factionsConfig.catalog) as FactionId[]) {
    if (existing.has(id)) continue
    world.spawn(
      Faction({ id, fund: 0 }),
      EntityKey({ key: factionKey(id) }),
    )
  }
}

// Look up the live Faction entity for `id` in `world`. Returns null if no
// Faction was bootstrapped (test setup, or a scene without civilians).
export function findFactionEntity(world: World, id: FactionId): Entity | null {
  for (const e of world.query(Faction)) {
    if (e.get(Faction)!.id === id) return e
  }
  return null
}

// Resolve the default Owner trait payload for `buildingTypeId`. Falls back
// to state ownership when the type isn't listed in ownership.json5 — keeps
// the spawn pipeline working when new building types land before their
// ownership row does.
export function defaultOwnerFor(
  world: World,
  buildingTypeId: string,
): TraitInstance<typeof Owner> {
  const def = ownershipConfig.defaults[buildingTypeId]
  if (!def || def.kind === 'state') return { kind: 'state', entity: null }
  const factionEntity = findFactionEntity(world, def.factionId)
  if (!factionEntity) {
    // Faction wasn't bootstrapped on this world — fall back to state so the
    // building is still ownable rather than carrying a dangling ref.
    return { kind: 'state', entity: null }
  }
  return { kind: 'faction', entity: factionEntity }
}
