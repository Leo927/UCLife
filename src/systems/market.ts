import type { Entity, World } from 'koota'
import { Workstation, Bed, Position, Job, Home, Money, Attributes } from '../ecs/traits'
import type { BedTier } from '../ecs/traits'
import { levelOf, getSkillXp } from '../character/skills'
import type { SkillId } from '../character/skills'
import { getJobSpec } from '../data/jobs'
import { useClock } from '../sim/clock'
import { economyConfig } from '../config'
import { bedActiveOccupant } from './bed'
import { getRep, hasFriendInFaction } from './reputation'
import { getStat } from '../stats/sheet'

function rentPriceFor(entity: Entity, listed: number): number {
  const a = entity.get(Attributes)
  const mul = a ? getStat(a.sheet, 'rentMul') : 1
  return Math.max(1, Math.round(listed * mul))
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

function bedRentDurationMs(tier: BedTier): number {
  if (tier === 'flop') return economyConfig.rent.flopBedHours * HOUR_MS
  return economyConfig.rent.bedRentDurationDays * DAY_MS
}

export function meetsRequirements(world: World, entity: Entity, ws: Entity): boolean {
  const w = ws.get(Workstation)
  if (!w) return false
  const spec = getJobSpec(w.specId)
  if (!spec) return false
  for (const [skill, lv] of Object.entries(spec.requirements)) {
    const xp = getSkillXp(entity, skill as SkillId)
    if (levelOf(xp) < (lv ?? 0)) return false
  }
  if (spec.repReq) {
    if (getRep(entity, spec.repReq.faction) < spec.repReq.min) return false
  }
  if (spec.relationReq) {
    const r = spec.relationReq
    if (!hasFriendInFaction(world, entity, r.faction, r.role, r.minOpinion)) return false
  }
  return true
}

export function findBestOpenJob(world: World, entity: Entity): Entity | null {
  let best: Entity | null = null
  let bestWage = -1
  for (const ws of world.query(Workstation)) {
    const w = ws.get(Workstation)!
    if (w.occupant !== null) continue
    const spec = getJobSpec(w.specId)
    if (!spec) continue
    if (spec.installOnly) continue
    if (!meetsRequirements(world, entity, ws)) continue
    if (spec.wage > bestWage) {
      bestWage = spec.wage
      best = ws
    }
  }
  return best
}

// Reset unemployedSinceMs to 0 on hire so a re-hired worker's grace period
// restarts cleanly on a future quit. installOnly seats route through their
// dedicated install dialog (installSecretary / installRecruiter) which sets
// the occupant directly — claimJob refuses them so a stray BT call can't
// seat someone behind the player's back.
export function claimJob(world: World, entity: Entity, ws: Entity): boolean {
  const w = ws.get(Workstation)
  if (!w || w.occupant !== null) return false
  const spec = getJobSpec(w.specId)
  if (spec?.installOnly) return false
  releaseJob(world, entity)
  ws.set(Workstation, { ...w, occupant: entity })
  if (entity.has(Job)) entity.set(Job, { workstation: ws, unemployedSinceMs: 0 })
  else entity.add(Job({ workstation: ws, unemployedSinceMs: 0 }))
  return true
}

// Stamps unemployedSinceMs so stress's grace period starts from release.
export function releaseJob(_world: World, entity: Entity): void {
  const j = entity.get(Job)
  if (!j || !j.workstation) return
  const ws = j.workstation
  const w = ws.get(Workstation)
  if (w && w.occupant === entity) {
    ws.set(Workstation, { ...w, occupant: null })
  }
  entity.set(Job, { workstation: null, unemployedSinceMs: useClock.getState().gameDate.getTime() })
}

export function getJobWorkstation(entity: Entity): Entity | null {
  const j = entity.get(Job)
  return j?.workstation ?? null
}

// Lounge included at rank 0 so the loop covers all tiers without crashing,
// but it's excluded from claim flow below.
const TIER_RANK: Record<BedTier, number> = { luxury: 4, apartment: 3, dorm: 2, flop: 1, lounge: 0 }

// "Open" treats lapsed-rent beds as free even when Bed.occupant still
// names the prior tenant.
export function findBestOpenBed(world: World, entity: Entity, money: number): Entity | null {
  const now = useClock.getState().gameDate.getTime()
  let best: Entity | null = null
  let bestScore = -Infinity
  for (const bed of world.query(Bed, Position)) {
    const b = bed.get(Bed)!
    // Lounge couches are AE-only transient naps, never a permanent home.
    if (b.tier === 'lounge') continue
    const active = bedActiveOccupant(b, now)
    if (active !== null && active !== entity) continue
    const price = rentPriceFor(entity, b.nightlyRent)
    if (price > money) continue
    const tierScore = TIER_RANK[b.tier as BedTier] ?? 0
    const score = tierScore * 1000 - price
    if (score > bestScore) {
      bestScore = score
      best = bed
    }
  }
  return best
}

// Re-entry within the same rent window succeeds without re-charging.
export function claimHome(world: World, entity: Entity, bed: Entity): boolean {
  const b = bed.get(Bed)
  if (!b) return false
  const now = useClock.getState().gameDate.getTime()
  const active = bedActiveOccupant(b, now)
  if (active !== null && active !== entity) return false

  const stillRented = active === entity
  if (stillRented) {
    releaseHome(world, entity)
    bed.set(Bed, { ...b, occupant: entity })
  } else {
    const price = rentPriceFor(entity, b.nightlyRent)
    const m = entity.get(Money)
    if (!m || m.amount < price) return false
    entity.set(Money, { amount: m.amount - price })
    releaseHome(world, entity)
    bed.set(Bed, {
      ...b,
      occupant: entity,
      rentPaidUntilMs: now + bedRentDurationMs(b.tier),
    })
  }

  if (entity.has(Home)) entity.set(Home, { bed })
  else entity.add(Home({ bed }))
  return true
}

export function releaseHome(_world: World, entity: Entity): void {
  const h = entity.get(Home)
  if (!h || !h.bed) return
  const bed = h.bed
  const b = bed.get(Bed)
  if (b && b.occupant === entity) {
    // Owned beds stay claimed until explicit sale (no UI yet). This makes
    // claimHome on a different bed a no-op against the owned one.
    if (!b.owned) {
      bed.set(Bed, { ...b, occupant: null })
    }
  }
  entity.set(Home, { bed: null })
}

export function buyHome(world: World, entity: Entity, bed: Entity, price: number): boolean {
  const b = bed.get(Bed)
  if (!b) return false
  if (b.owned && b.occupant === entity) return true
  const now = useClock.getState().gameDate.getTime()
  const active = bedActiveOccupant(b, now)
  if (active !== null && active !== entity) return false
  const m = entity.get(Money)
  if (!m || m.amount < price) return false
  entity.set(Money, { amount: m.amount - price })
  releaseHome(world, entity)
  bed.set(Bed, {
    ...b,
    occupant: entity,
    owned: true,
    rentPaidUntilMs: 0,
  })
  if (entity.has(Home)) entity.set(Home, { bed })
  else entity.add(Home({ bed }))
  return true
}

// Workstation with unknown specId reads as permanently closed.
export function isWorkstationOpen(ws: Entity, date: Date): boolean {
  const w = ws.get(Workstation)
  if (!w) return false
  const spec = getJobSpec(w.specId)
  if (!spec) return false
  if (!spec.workDays.includes(date.getDay())) return false
  const m = date.getHours() * 60 + date.getMinutes()
  return m >= spec.shiftStart * 60 && m < spec.shiftEnd * 60
}
