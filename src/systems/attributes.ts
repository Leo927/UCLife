// Attribute drift, feed, and read API. The six attributes (strength..
// resolve) drift toward a daily target derived from a 7-day rolling
// recentUse / recentStress buffer; the buffer is the only place this
// system writes — nothing here adds modifiers. Modifiers live on the
// per-character StatSheet (src/stats/sheet.ts) and are layered on top
// of the drifted base whenever a system reads via statValue().
//
// Resolve is currently excluded from drift — its feed source is Newtype
// activity, not yet implemented.

import type { Entity, World } from 'koota'
import { Attributes } from '../ecs/traits'
import {
  STAT_FLOOR, STAT_DRIFT,
  RECENT_USE_DECAY_PER_DAY, RECENT_STRESS_DECAY_PER_DAY,
} from '../data/stats'
import type { StatId, StatSheet, AttributeDrift } from '../ecs/traits'
import { setBase, getStat } from '../stats/sheet'
import { ATTRIBUTE_IDS, type AttributeId } from '../stats/schema'

const ATTRIBUTE_ID_SET: ReadonlySet<string> = new Set<string>(ATTRIBUTE_IDS)

const MS_PER_DAY = 24 * 60 * 60 * 1000

function dayId(date: Date): number {
  return Math.floor(date.getTime() / MS_PER_DAY)
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

// Resolve is omitted — its feed source isn't wired yet, so drifting it
// would atrophy unstoppably.
const DRIFTING_STATS: AttributeId[] = ['strength', 'endurance', 'charisma', 'intelligence', 'reflex']

// Decays the 7-day rolling buffers BEFORE computing today's target so a
// single hard day can't push a stat straight to 100. Returns the new
// sheet snapshot (immutable) plus the mutated drift entry — caller is
// responsible for stitching the drift map back together.
function driftOneDay(
  sheet: StatSheet<StatId>,
  id: AttributeId,
  drift: AttributeDrift,
): { sheet: StatSheet<StatId>; drift: AttributeDrift } {
  const next: AttributeDrift = {
    talent: drift.talent,
    recentUse: drift.recentUse * RECENT_USE_DECAY_PER_DAY,
    recentStress: drift.recentStress * RECENT_STRESS_DECAY_PER_DAY,
  }
  const cap = next.talent * 100
  const target = clamp(next.recentUse * next.talent - next.recentStress, STAT_FLOOR, cap)
  const cur = sheet.stats[id].base
  const newBase = clamp(cur + (target - cur) * STAT_DRIFT, 0, 100)
  return { sheet: setBase(sheet, id, newBase), drift: next }
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
    let sheet = attr.sheet
    const drift = { ...attr.drift }
    for (let d = 0; d < days; d++) {
      for (const id of DRIFTING_STATS) {
        const step = driftOneDay(sheet, id, drift[id])
        sheet = step.sheet
        drift[id] = step.drift
      }
    }
    attr.sheet = sheet
    attr.drift = drift
    attr.lastDriftDay = today
  })
}

function isDriftingStat(stat: StatId): stat is AttributeId {
  return ATTRIBUTE_ID_SET.has(stat)
}

export function feedUse(entity: Entity, stat: StatId, intensityPerMin: number, gameMinutes: number): void {
  if (stat === 'resolve' || !isDriftingStat(stat)) return
  const a = entity.get(Attributes)
  if (!a) return
  const cur = a.drift[stat]
  const next: AttributeDrift = {
    talent: cur.talent,
    recentUse: clamp(cur.recentUse + intensityPerMin * gameMinutes, 0, 100),
    recentStress: cur.recentStress,
  }
  entity.set(Attributes, { ...a, drift: { ...a.drift, [stat]: next } })
}

export function feedStress(entity: Entity, stat: StatId, intensityPerMin: number, gameMinutes: number): void {
  if (stat === 'resolve' || !isDriftingStat(stat)) return
  const a = entity.get(Attributes)
  if (!a) return
  const cur = a.drift[stat]
  const next: AttributeDrift = {
    talent: cur.talent,
    recentUse: cur.recentUse,
    recentStress: clamp(cur.recentStress + intensityPerMin * gameMinutes, 0, 100),
  }
  entity.set(Attributes, { ...a, drift: { ...a.drift, [stat]: next } })
}

// Effective stat after modifiers. Defaults to the schema's spawn baseline
// when entity lacks Attributes, so callers don't need null-guards.
export function statValue(entity: Entity, stat: StatId): number {
  const a = entity.get(Attributes)
  if (!a) return stat === 'resolve' || isDriftingStat(stat) ? 50 : 0
  return getStat(a.sheet, stat)
}
