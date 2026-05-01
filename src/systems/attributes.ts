// Resolve is currently excluded from drift — its feed source is Newtype
// activity, not yet implemented.

import type { Entity, World } from 'koota'
import { Attributes } from '../ecs/traits'
import type { StatState } from '../ecs/traits'
import {
  STAT_FLOOR, STAT_DRIFT,
  RECENT_USE_DECAY_PER_DAY, RECENT_STRESS_DECAY_PER_DAY,
} from '../data/stats'
import type { StatId } from '../data/stats'

const MS_PER_DAY = 24 * 60 * 60 * 1000

function dayId(date: Date): number {
  return Math.floor(date.getTime() / MS_PER_DAY)
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

const DRIFTING_STATS: StatId[] = ['strength', 'endurance', 'charisma', 'intelligence', 'reflex']

// Decay buffers BEFORE computing today's target so a single hard day can't
// push a stat straight to 100.
function driftOneDay(s: StatState): void {
  s.recentUse *= RECENT_USE_DECAY_PER_DAY
  s.recentStress *= RECENT_STRESS_DECAY_PER_DAY
  const cap = s.talent * 100
  const target = clamp(s.recentUse * s.talent - s.recentStress, STAT_FLOOR, cap)
  s.value = clamp(s.value + (target - s.value) * STAT_DRIFT, 0, 100)
}

// Idempotent within a game-day; per-tick early-out is cheap.
export function attributesSystem(world: World, gameDate: Date): void {
  const today = dayId(gameDate)
  world.query(Attributes).updateEach(([attr]) => {
    if (attr.lastDriftDay === 0) {
      attr.lastDriftDay = today
      return
    }
    const days = today - attr.lastDriftDay
    if (days <= 0) return
    for (let d = 0; d < days; d++) {
      for (const id of DRIFTING_STATS) driftOneDay(attr[id])
    }
    attr.lastDriftDay = today
  })
}

export function feedUse(entity: Entity, stat: StatId, intensityPerMin: number, gameMinutes: number): void {
  if (stat === 'resolve') return
  const a = entity.get(Attributes)
  if (!a) return
  const s = a[stat]
  s.recentUse = clamp(s.recentUse + intensityPerMin * gameMinutes, 0, 100)
  entity.set(Attributes, a)
}

export function feedStress(entity: Entity, stat: StatId, intensityPerMin: number, gameMinutes: number): void {
  if (stat === 'resolve') return
  const a = entity.get(Attributes)
  if (!a) return
  const s = a[stat]
  s.recentStress = clamp(s.recentStress + intensityPerMin * gameMinutes, 0, 100)
  entity.set(Attributes, a)
}

// Defaults to 50 (spawn baseline) when entity lacks Attributes.
export function statValue(entity: Entity, stat: StatId): number {
  const a = entity.get(Attributes)
  return a ? a[stat].value : 50
}
