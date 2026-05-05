// Per-tick ambition progression. Reads requirement values from the player's
// existing traits (Attributes, Skills, Money, Reputation, FactionRole, Home)
// plus a small set of derived accessors (aeRank, residenceTier, hasNoJob,
// hasNoHome, daysAtFlopWithNoJob). On stage advance, fires the payoff:
// title overrides Character.title, log line is pushed to the event log,
// unlock flags are set on the player's Flags trait, and Ambition Points
// are credited to the Ambitions trait. warPayoff is inert in 5.0.
//
// Cheap (one entity, multiple active × handful of reads) so no throttling.

import type { Entity, World } from 'koota'
import {
  Ambitions, Flags, IsPlayer, Character, Money, Reputation,
  FactionRole, Home, Bed, Job,
  type AmbitionSlot,
} from '../ecs/traits'
import { statValue } from './attributes'
import {
  ambitions, getAmbition, requirementSatisfied,
  type RequirementValue,
} from '../character/ambitions'
import type { FactionId } from '../data/factions'
import { getSkillXp, type SkillId } from '../character/skills'
import { emitSim } from '../sim/events'

const ATTRIBUTE_KEYS = new Set(['strength', 'endurance', 'charisma', 'intelligence', 'reflex', 'resolve'])
const SKILL_KEYS = new Set<string>([
  'mechanics', 'marksmanship', 'athletics', 'cooking', 'medicine', 'computers',
  'piloting', 'bartending', 'engineering',
])
const FACTION_KEYS = new Set<string>(['anaheim', 'civilian', 'federation', 'zeon'])

const MS_PER_DAY = 24 * 60 * 60 * 1000

function aeRankValue(entity: Entity): number {
  const fr = entity.get(FactionRole)
  if (!fr || fr.faction !== 'anaheim') return 0
  switch (fr.role) {
    case 'staff': return 0
    case 'manager': return 1
    case 'board': return 2
  }
}

function residenceTierValue(entity: Entity): number {
  const home = entity.get(Home)
  if (!home || !home.bed) return 0
  const bed = home.bed.get(Bed)
  if (!bed) return 0
  switch (bed.tier) {
    case 'flop': return 1
    case 'dorm': return 2
    case 'apartment': return 3
    case 'luxury': return 4
    case 'lounge': return 0
  }
}

function hasNoJobValue(entity: Entity): number {
  const job = entity.get(Job)
  return !job || job.workstation === null ? 1 : 0
}

function hasNoHomeValue(entity: Entity): number {
  const home = entity.get(Home)
  return !home || home.bed === null ? 1 : 0
}

function dropoutConditionsMet(entity: Entity): boolean {
  return hasNoJobValue(entity) === 1 && residenceTierValue(entity) <= 1
}

function daysAtFlopWithNoJobValue(slot: AmbitionSlot, currentMs: number): number {
  if (slot.streakAnchorMs === null) return 0
  return Math.max(0, Math.floor((currentMs - slot.streakAnchorMs) / MS_PER_DAY))
}

export function readRequirementValue(
  entity: Entity,
  key: string,
  slot: AmbitionSlot,
  currentMs: number,
): number {
  if (ATTRIBUTE_KEYS.has(key)) {
    return statValue(entity, key as 'strength')
  }
  if (SKILL_KEYS.has(key)) {
    return getSkillXp(entity, key as SkillId)
  }
  if (key === 'money') {
    return entity.get(Money)?.amount ?? 0
  }
  if (FACTION_KEYS.has(key)) {
    const r = entity.get(Reputation)
    return r?.rep[key as FactionId] ?? 0
  }
  if (key === 'aeRank') return aeRankValue(entity)
  if (key === 'residenceTier') return residenceTierValue(entity)
  if (key === 'hasNoJob') return hasNoJobValue(entity)
  if (key === 'hasNoHome') return hasNoHomeValue(entity)
  if (key === 'daysAtFlopWithNoJob') return daysAtFlopWithNoJobValue(slot, currentMs)
  return 0
}

export interface RequirementProgress {
  key: string
  current: number
  requirement: RequirementValue
  satisfied: boolean
}

export function readStageProgress(
  entity: Entity,
  slot: AmbitionSlot,
  currentMs: number,
): RequirementProgress[] {
  const def = getAmbition(slot.id)
  if (!def) return []
  const stage = def.stages[slot.currentStage]
  if (!stage) return []
  return Object.entries(stage.requirements).map(([key, req]) => {
    const current = readRequirementValue(entity, key, slot, currentMs)
    return { key, current, requirement: req, satisfied: requirementSatisfied(current, req) }
  })
}

export function ambitionsSystem(world: World, gameDate: Date): void {
  const player = world.queryFirst(IsPlayer, Ambitions)
  if (!player) return

  const amb = player.get(Ambitions)!
  if (amb.active.length === 0) return  // First-run picker open; nothing to advance.

  const currentMs = gameDate.getTime()
  let dirty = false
  let titleOverride: string | null = null
  let apGained = 0

  for (let i = 0; i < amb.active.length; i++) {
    const slot = amb.active[i]
    const def = getAmbition(slot.id)
    if (!def) continue
    const stage = def.stages[slot.currentStage]
    if (!stage) continue  // Already past last stage.

    const usesStreak = 'daysAtFlopWithNoJob' in stage.requirements
    if (usesStreak) {
      if (dropoutConditionsMet(player)) {
        if (slot.streakAnchorMs === null) {
          slot.streakAnchorMs = currentMs
          dirty = true
        }
      } else if (slot.streakAnchorMs !== null) {
        slot.streakAnchorMs = null
        dirty = true
      }
    }

    let allMet = true
    for (const [key, req] of Object.entries(stage.requirements)) {
      const cur = readRequirementValue(player, key, slot, currentMs)
      if (!requirementSatisfied(cur, req)) { allMet = false; break }
    }
    if (!allMet) continue

    // Stage advance.
    slot.currentStage += 1
    slot.streakAnchorMs = null
    dirty = true

    titleOverride = stage.payoff.titleZh
    emitSim('log', { textZh: stage.payoff.logZh, atMs: currentMs })
    if (stage.payoff.unlocks && stage.payoff.unlocks.length > 0) {
      const flagsTrait = player.get(Flags)
      if (flagsTrait) {
        const nextFlags = { ...flagsTrait.flags }
        for (const f of stage.payoff.unlocks) nextFlags[f] = true
        player.set(Flags, { flags: nextFlags })
      }
    }
    const ap = stage.payoff.ap ?? 1
    apGained += ap
    if (ap > 0) {
      emitSim('log', { textZh: `获得志向点 +${ap}`, atMs: currentMs })
    }
  }

  if (dirty || apGained > 0) {
    player.set(Ambitions, {
      active: amb.active,
      history: amb.history,
      apBalance: amb.apBalance + apGained,
      apEarned: amb.apEarned + apGained,
      perks: amb.perks,
    })
  }
  if (titleOverride !== null) {
    const ch = player.get(Character)
    if (ch) player.set(Character, { ...ch, title: titleOverride })
  }
}

export function allAmbitions() {
  return ambitions
}
