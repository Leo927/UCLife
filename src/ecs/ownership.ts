// Phase 5.5 ownership layer. Three responsibilities now:
//   1. Bootstrap a Faction entity per FactionId in each scene world so
//      Owner.entity has a stable target to reference.
//   2. Resolve the default Owner for a building type at spawn time.
//   3. After NPCs spawn, re-stamp 'private' buildings with named NPC owners
//      so the realtor has a private-inventory band from day one (5.5.1).
//
// Future phases hang revenue / payroll / insolvency systems off this same
// trait pair.

import type { Entity, World, TraitInstance } from 'koota'
import { Faction, EntityKey, Owner, Building, Character, Money, IsPlayer, FactionRole } from './traits'
import { factionsConfig, ownershipConfig, isPrivateBuildingType, type FactionId } from '../config'
import { SeededRng } from '../procgen'

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
// ownership row does. Private types are seated as state and re-stamped by
// seedPrivateOwners after NPCs spawn.
export function defaultOwnerFor(
  world: World,
  buildingTypeId: string,
): TraitInstance<typeof Owner> {
  const def = ownershipConfig.defaults[buildingTypeId]
  if (!def || def.kind === 'state' || def.kind === 'private') {
    return { kind: 'state', entity: null }
  }
  const factionEntity = findFactionEntity(world, def.factionId)
  if (!factionEntity) {
    // Faction wasn't bootstrapped on this world — fall back to state so the
    // building is still ownable rather than carrying a dangling ref.
    return { kind: 'state', entity: null }
  }
  return { kind: 'faction', entity: factionEntity }
}

// Pick deterministically from candidate NPCs in `world` so private buildings
// get named owners on day one. Skips NPCs that are AE board/management (those
// own the AE complex via faction ownership), the player, and characters
// without a Money trait (so we can model owner solvency next phase). Cycles
// through eligible NPCs in EntityKey-sorted order — multiple buildings may
// share an owner when there are fewer NPCs than private buildings.
//
// `seedSuffix` is folded into the per-scene RNG so two scenes with the same
// building roster don't pick identical owners.
export function seedPrivateOwners(world: World, seedSuffix: string): void {
  const candidates: { ent: Entity; key: string }[] = []
  for (const c of world.query(Character, EntityKey)) {
    if (c.has(IsPlayer)) continue
    if (!c.has(Money)) continue
    const fr = c.get(FactionRole)
    // Anaheim staff don't moonlight as private landlords — they're employed
    // full-time by the AE faction and surface a different ownership shape.
    if (fr && fr.faction === 'anaheim') continue
    candidates.push({ ent: c, key: c.get(EntityKey)!.key })
  }
  if (candidates.length === 0) return
  candidates.sort((a, b) => a.key.localeCompare(b.key))

  const buildings: { ent: Entity; key: string }[] = []
  for (const b of world.query(Building, EntityKey, Owner)) {
    const bt = b.get(Building)!
    if (!isPrivateBuildingType(bt.typeId)) continue
    const o = b.get(Owner)!
    // Only re-stamp the temporary state holding pattern; respect anything
    // already character/faction-owned (test setup, save load, future phases).
    if (o.kind !== 'state') continue
    buildings.push({ ent: b, key: b.get(EntityKey)!.key })
  }
  if (buildings.length === 0) return
  buildings.sort((a, b) => a.key.localeCompare(b.key))

  const rng = SeededRng.fromString(`private-owners:${seedSuffix}`)
  for (const b of buildings) {
    const pick = candidates[rng.intRange(0, candidates.length - 1)]
    b.ent.set(Owner, { kind: 'character', entity: pick.ent })
  }
}
