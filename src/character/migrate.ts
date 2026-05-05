// Cross-scene player migration. koota entity ids are world-stamped, so an
// Entity from scene A can't be inserted into scene B's world — the move is
// a destroy-and-respawn driven by trait snapshots.
//
// Job, Home, and PendingEviction are intentionally NOT carried over: they
// reference origin-scene entities (Workstation, Bed) that don't exist in
// the destination. Re-establishing those is the destination scene's job.
//
// Back-reference cleanup (Bed.occupant, Workstation.occupant pointing at
// the migrating player) is the caller's responsibility — that walk is
// scene-bootstrap-shaped, not character-shaped, and lives in sim/scene.ts.

import type { Entity, World } from 'koota'
import {
  IsPlayer, Position, MoveTarget, Action, Vitals, Health, Money,
  Inventory, Job, JobPerformance, Attributes, Reputation, JobTenure,
  Character, Appearance, FactionRole, Flags, Ambitions, EntityKey,
  Home, PendingEviction,
} from '../ecs/traits'

export function migratePlayerEntity(
  srcEntity: Entity,
  destWorld: World,
  arrivalPos: { x: number; y: number },
): Entity {
  const character = srcEntity.get(Character)
  const vitals = srcEntity.get(Vitals)
  const health = srcEntity.get(Health)
  const money = srcEntity.get(Money)
  const inventory = srcEntity.get(Inventory)
  const attributes = srcEntity.get(Attributes)
  const reputation = srcEntity.get(Reputation)
  const jobTenure = srcEntity.get(JobTenure)
  const appearance = srcEntity.get(Appearance)
  const factionRole = srcEntity.get(FactionRole)
  const flags = srcEntity.get(Flags)
  const ambitions = srcEntity.get(Ambitions)

  srcEntity.destroy()

  const { x, y } = arrivalPos
  const ent = destWorld.spawn(
    IsPlayer,
    character ? Character(character) : Character,
    Position({ x, y }),
    MoveTarget({ x, y }),
    vitals ? Vitals(vitals) : Vitals,
    health ? Health(health) : Health,
    Action({ kind: 'idle', remaining: 0, total: 0 }),
    money ? Money(money) : Money,
    inventory ? Inventory(inventory) : Inventory,
    Job,
    JobPerformance,
    attributes ? Attributes(attributes) : Attributes,
    reputation ? Reputation(reputation) : Reputation,
    jobTenure ? JobTenure(jobTenure) : JobTenure,
    EntityKey({ key: 'player' }),
  )
  if (appearance) ent.add(Appearance(appearance))
  if (factionRole) ent.add(FactionRole(factionRole))
  if (flags) ent.add(Flags({ flags: { ...flags.flags } }))
  if (ambitions) {
    ent.add(Ambitions({
      active: ambitions.active.map((s) => ({ ...s })),
      history: ambitions.history.map((h) => ({ ...h })),
      apBalance: ambitions.apBalance,
      apEarned: ambitions.apEarned,
      perks: [...ambitions.perks],
    }))
  }
  // Guard against accidentally carrying origin-scene refs across the
  // boundary if a respawn ever picks these up.
  if (ent.has(Home)) ent.remove(Home)
  if (ent.has(PendingEviction)) ent.remove(PendingEviction)
  return ent
}
