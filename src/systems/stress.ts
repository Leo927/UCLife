// feedStress on Resolve is a no-op until Resolve participates in drift.

import { trait } from 'koota'
import type { Entity, World } from 'koota'
import { Active, Attributes, Vitals, Health, Action, Job, Home, IsPlayer } from '../ecs/traits'
import { feedStress } from './attributes'
import type { StatId } from '../data/stats'
import { attributesConfig, worldConfig } from '../config'
import { worldSingleton } from '../ecs/resources'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const SLOW_FACTOR = worldConfig.activeZone.inactiveSlowFactor
const COARSE_TICK_MIN = worldConfig.activeZone.inactiveCoarseTickMin

// Resolve omitted — feedStress would no-op anyway.
const ALL_PHYSICAL: StatId[] = ['strength', 'endurance', 'charisma', 'intelligence', 'reflex']

// Per-world inactive-NPC accumulator. Same Inactive flush semantics as
// vitalsSystem; kept separate so each system can be reset and inspected
// independently. Hoisted to the per-world singleton — see vitals.ts
// header for why Map<Entity, T> at module scope is unsafe under multi-world.
const StressAccum = trait(() => ({ inactiveAccumMin: new Map<Entity, number>() }))

function accumOf(world: World): Map<Entity, number> {
  const e = worldSingleton(world)
  if (!e.has(StressAccum)) e.add(StressAccum)
  return e.get(StressAccum)!.inactiveAccumMin
}

export function resetStressAccum(world: World): void {
  accumOf(world).clear()
}

export function stressSystem(world: World, gameMinutes: number, gameDate: Date): void {
  const cfg = attributesConfig.stress
  const TH = cfg.vitalSaturationThreshold
  const F = cfg.feeds
  const graceMs = cfg.unemploymentGraceDays * MS_PER_DAY
  const now = gameDate.getTime()
  const inactiveAccumMin = accumOf(world)

  for (const entity of world.query(Attributes, Vitals, Health, Action)) {
    const v = entity.get(Vitals)!
    const h = entity.get(Health)!
    const a = entity.get(Action)!
    if (h.dead) {
      inactiveAccumMin.delete(entity)
      continue
    }

    let effMinutes: number
    if (entity.has(IsPlayer) || entity.has(Active)) {
      const carry = inactiveAccumMin.get(entity)
      if (carry !== undefined && carry > 0) {
        effMinutes = gameMinutes + carry * SLOW_FACTOR
        inactiveAccumMin.delete(entity)
      } else {
        effMinutes = gameMinutes
      }
    } else {
      const acc = (inactiveAccumMin.get(entity) ?? 0) + gameMinutes
      if (acc < COARSE_TICK_MIN) {
        inactiveAccumMin.set(entity, acc)
        continue
      }
      inactiveAccumMin.set(entity, 0)
      effMinutes = acc * SLOW_FACTOR
    }

    if (v.hygiene >= TH) feedStress(entity, 'charisma', F.hygieneSaturated, effMinutes)
    if (v.hunger >= TH) {
      feedStress(entity, 'strength', F.hungerSaturated, effMinutes)
      feedStress(entity, 'endurance', F.hungerSaturated, effMinutes)
    }
    if (v.thirst >= TH) {
      feedStress(entity, 'endurance', F.thirstSaturated, effMinutes)
      feedStress(entity, 'intelligence', F.thirstSaturated, effMinutes)
    }
    if (v.fatigue >= TH) {
      feedStress(entity, 'reflex', F.fatigueSaturated, effMinutes)
      feedStress(entity, 'intelligence', F.fatigueSaturated, effMinutes)
    }

    // Severe replaces hurt; mutually exclusive.
    if (h.hp < 25) {
      for (const s of ALL_PHYSICAL) feedStress(entity, s, F.hpSevere, effMinutes)
    } else if (h.hp < 50) {
      for (const s of ALL_PHYSICAL) feedStress(entity, s, F.hpHurt, effMinutes)
    }

    const home = entity.get(Home)
    if (!home || !home.bed) {
      feedStress(entity, 'charisma', F.homeless, effMinutes)
    }

    const job = entity.get(Job)
    if (job && !job.workstation) {
      if (job.unemployedSinceMs === 0) {
        // Start the unemployment timer. releaseJob stamps this directly,
        // so this branch only fires for never-employed fresh spawns.
        entity.set(Job, { ...job, unemployedSinceMs: now })
      } else if (now - job.unemployedSinceMs > graceMs) {
        for (const s of ALL_PHYSICAL) feedStress(entity, s, F.unemployedLong, effMinutes)
      }
    }

    if (a.kind === 'reveling') {
      feedStress(entity, 'strength', F.reveling, effMinutes)
    }
  }
}
