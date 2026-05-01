// getRep treats "no Reputation trait" and "explicitly +0 rep" both as 0,
// so callers never need a trait-presence check.

import type { Entity, World } from 'koota'
import { Reputation, FactionRole, Knows } from '../ecs/traits'
import type { FactionId } from '../data/factions'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function getRep(entity: Entity, faction: FactionId): number {
  const r = entity.get(Reputation)
  if (!r) return 0
  return r.rep[faction] ?? 0
}

export function addRep(entity: Entity, faction: FactionId, delta: number): void {
  if (delta === 0) return
  const current = getRep(entity, faction)
  const next = clamp(current + delta, -100, 100)
  if (entity.has(Reputation)) {
    const r = entity.get(Reputation)!
    entity.set(Reputation, { rep: { ...r.rep, [faction]: next } })
  } else {
    entity.add(Reputation({ rep: { [faction]: next } }))
  }
}

export function hasFriendInFaction(
  world: World,
  entity: Entity,
  faction: FactionId,
  role: 'staff' | 'manager' | 'board',
  minOpinion: number,
): boolean {
  for (const target of world.query(FactionRole)) {
    if (target === entity) continue
    const fr = target.get(FactionRole)!
    if (fr.faction !== faction || fr.role !== role) continue
    const edge = entity.get(Knows(target))
    if (!edge) continue
    if (edge.opinion >= minOpinion) return true
  }
  return false
}
