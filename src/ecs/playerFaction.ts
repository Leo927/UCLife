// Phase 5.5.3 player-faction queries. The player-faction is aliased to
// the player's wallet + owned facilities until 5.5.5 ships explicit
// creation; this module derives "members" / "facilities" / "beds" from
// that alias without a new trait.
//
// A *member* of the pre-creation player-faction is any character who
// either:
//   • currently occupies a Workstation in a player-owned Building, or
//   • holds a faction-bed claim (Bed.claimedBy === character) on a bed
//     inside a player-owned residential facility.
//
// Both surfaces draw from the same set of NPCs: the staff the player
// employs and the housed members the secretary tracks. A character on
// either list is a member; the union avoids double-counting.

import type { Entity, World } from 'koota'
import {
  Building, Owner, IsPlayer, Workstation, Bed, Position,
  Character, EntityKey, Job, Knows,
} from './traits'

// True when the building is currently owned by the player. Faction-owned
// is *not* a player alias under the pre-creation model — only direct
// character ownership maps to the player-faction.
export function isPlayerOwnedBuilding(building: Entity, player: Entity): boolean {
  const o = building.get(Owner)
  if (!o) return false
  return o.kind === 'character' && o.entity === player
}

export function findPlayer(world: World): Entity | null {
  return world.queryFirst(IsPlayer) ?? null
}

export function playerOwnedBuildings(world: World, player: Entity): Entity[] {
  const out: Entity[] = []
  for (const b of world.query(Building, Owner)) {
    if (isPlayerOwnedBuilding(b, player)) out.push(b)
  }
  return out
}

// Walk every Workstation, return those whose Position falls inside a
// player-owned Building. Used for both the secretary roster and the
// job-site interaction panel.
export function playerOwnedWorkstations(
  world: World,
  player: Entity,
): { ws: Entity; building: Entity }[] {
  const buildings = playerOwnedBuildings(world, player)
  if (buildings.length === 0) return []
  const out: { ws: Entity; building: Entity }[] = []
  for (const ws of world.query(Workstation, Position)) {
    const wsPos = ws.get(Position)!
    for (const b of buildings) {
      const bld = b.get(Building)!
      if (wsPos.x < bld.x || wsPos.x >= bld.x + bld.w) continue
      if (wsPos.y < bld.y || wsPos.y >= bld.y + bld.h) continue
      out.push({ ws, building: b })
      break
    }
  }
  return out
}

// Beds inside player-owned Buildings, regardless of claim status. The
// secretary's auto-assignment + the housing-pressure check both walk
// this set.
export function playerOwnedBeds(world: World, player: Entity): Entity[] {
  const buildings = playerOwnedBuildings(world, player)
  if (buildings.length === 0) return []
  const out: Entity[] = []
  for (const bed of world.query(Bed, Position)) {
    const pos = bed.get(Position)!
    for (const b of buildings) {
      const bld = b.get(Building)!
      if (pos.x < bld.x || pos.x >= bld.x + bld.w) continue
      if (pos.y < bld.y || pos.y >= bld.y + bld.h) continue
      out.push(bed)
      break
    }
  }
  return out
}

// Members of the pre-creation player-faction. Union of NPCs working at a
// player-owned workstation and NPCs claiming a player-owned bed. Player
// itself is excluded — they're the owner, not a member.
export function playerFactionMembers(world: World, player: Entity): Entity[] {
  const set = new Set<Entity>()
  for (const { ws } of playerOwnedWorkstations(world, player)) {
    const occ = ws.get(Workstation)!.occupant
    if (!occ) continue
    if (occ === player) continue
    if (!occ.has(Character)) continue
    set.add(occ)
  }
  for (const bed of playerOwnedBeds(world, player)) {
    const claimer = bed.get(Bed)!.claimedBy
    if (!claimer) continue
    if (claimer === player) continue
    if (!claimer.has(Character)) continue
    set.add(claimer)
  }
  return Array.from(set)
}

// Members without a workstation occupied in any player-owned facility.
// Surfaced by the secretary's "roster the idle members" verb.
export function idlePlayerFactionMembers(world: World, player: Entity): Entity[] {
  const employed = new Set<Entity>()
  for (const { ws } of playerOwnedWorkstations(world, player)) {
    const occ = ws.get(Workstation)!.occupant
    if (occ) employed.add(occ)
  }
  return playerFactionMembers(world, player).filter((m) => !employed.has(m))
}

// Workstations in player-owned facilities currently sitting vacant.
// The secretary's auto-assignment fills these before reporting back.
export function vacantPlayerOwnedWorkstations(
  world: World,
  player: Entity,
): { ws: Entity; building: Entity }[] {
  return playerOwnedWorkstations(world, player).filter(
    ({ ws }) => ws.get(Workstation)!.occupant === null,
  )
}

// Beds in player-owned residences without a faction claim. The secretary
// pulls from this list to auto-assign housed members; housing pressure
// reads its size to compute the shortfall.
export function unclaimedPlayerOwnedBeds(world: World, player: Entity): Entity[] {
  return playerOwnedBeds(world, player).filter(
    (bed) => bed.get(Bed)!.claimedBy === null,
  )
}

// Members holding a player-owned bed claim. Compared against
// playerFactionMembers() to compute the housing-pressure shortfall.
export function housedPlayerFactionMembers(
  world: World,
  player: Entity,
): Set<Entity> {
  const out = new Set<Entity>()
  for (const bed of playerOwnedBeds(world, player)) {
    const claimer = bed.get(Bed)!.claimedBy
    if (!claimer) continue
    if (claimer === player) continue
    if (!claimer.has(Character)) continue
    out.add(claimer)
  }
  return out
}

// Members whose faction-of-one membership lacks a bed claim. Housing
// pressure decays Knows(member→player).opinion against this set per day.
export function unhousedPlayerFactionMembers(
  world: World,
  player: Entity,
): Entity[] {
  const housed = housedPlayerFactionMembers(world, player)
  return playerFactionMembers(world, player).filter((m) => !housed.has(m))
}

// Member display name — falls back to entity-key when the Character
// trait is missing (defensive; spawnNPC always adds it).
export function memberDisplayName(ent: Entity): string {
  return ent.get(Character)?.name ?? ent.get(EntityKey)?.key ?? '?'
}

// Used by SecretaryConversation's idle-roster verb. A member-fits-station
// match is loose — we don't model skills here; the v1 verb just fills any
// vacant station the player is qualified to staff. Skill-tier matching
// lands with the recruiter office in 5.5.4.
export function couldFillStation(_member: Entity, _ws: Entity): boolean {
  return true
}

// Drop any Job pointer the member is currently holding before re-seating
// them. Mirrors HRConversation.accept's handover logic so two stations
// can't both list the same occupant.
export function clearMemberJob(member: Entity): void {
  const job = member.get(Job)
  if (!job?.workstation) return
  const cur = job.workstation.get(Workstation)
  if (cur && cur.occupant === member) {
    job.workstation.set(Workstation, { ...cur, occupant: null })
  }
  member.set(Job, { workstation: null, unemployedSinceMs: 0 })
}

// Read the seller→player Knows opinion in a typed way. Used by
// housingPressure to bound the per-day decrement against the floor.
export function memberOpinionOfPlayer(member: Entity, player: Entity): number {
  if (!member.has(Knows(player))) return 0
  const e = member.get(Knows(player))
  return e ? e.opinion : 0
}
