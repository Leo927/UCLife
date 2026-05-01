import type { Entity, World, TraitInstance } from 'koota'
import { Bed, Home, Position } from '../ecs/traits'
import type { BedTier } from '../ecs/traits'
import { actionsConfig } from '../config'

export const BED_MULTIPLIERS: Record<BedTier | 'none', number> = actionsConfig.bedMultipliers

// Lapsed-rent Bed.occupant is stale — rent system GCs shortly. Owned beds
// bypass rent-window expiry.
type BedData = TraitInstance<typeof Bed>
export function bedActiveOccupant(b: BedData, nowMs: number): Entity | null {
  if (!b.occupant) return null
  if (b.owned) return b.occupant
  if (b.rentPaidUntilMs > nowMs) return b.occupant
  return null
}

// Verify b.occupant === entity to guard against eviction races where
// Home.bed clearing hasn't yet propagated. `world` kept for API compat.
export function getBedMultiplierFor(_world: World, entity: Entity): number {
  const home = entity.get(Home)
  if (!home || !home.bed) return BED_MULTIPLIERS.none
  const b = home.bed.get(Bed)
  if (!b) return BED_MULTIPLIERS.none
  if (b.occupant !== entity) return BED_MULTIPLIERS.none
  return BED_MULTIPLIERS[b.tier as BedTier] ?? 1.0
}

// Forfeits unused flop-rent time.
export function releaseBedFor(world: World, entity: Entity): void {
  for (const e of world.query(Bed)) {
    const b = e.get(Bed)!
    if (b.occupant === entity) {
      e.set(Bed, { ...b, occupant: null, rentPaidUntilMs: 0 })
    }
  }
}

export function findNearestFreeBed(
  world: World,
  pos: { x: number; y: number },
  tier: BedTier,
  maxDist: number,
): Entity | null {
  let best: Entity | null = null
  let bestDist = maxDist
  for (const e of world.query(Bed, Position)) {
    const b = e.get(Bed)!
    if (b.tier !== tier) continue
    if (b.occupant !== null) continue
    const p = e.get(Position)!
    const d = Math.hypot(pos.x - p.x, pos.y - p.y)
    if (d < bestDist) {
      bestDist = d
      best = e
    }
  }
  return best
}

