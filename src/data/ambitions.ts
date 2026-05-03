import json5 from 'json5'
import raw from './ambitions.json5?raw'
import type { FactionId } from './factions'
import type { SkillId } from './skills'

// Requirement keys are validated against this hand-maintained allow-list at
// module load — silent typos cause silent ambition stalls, the worst possible
// bug for a system whose entire job is "advance when conditions are met".

const ATTRIBUTE_KEYS = ['strength', 'endurance', 'charisma', 'intelligence', 'reflex', 'resolve'] as const
export type AttributeKey = typeof ATTRIBUTE_KEYS[number]

const SKILL_KEYS: SkillId[] = [
  'mechanics', 'marksmanship', 'athletics', 'cooking', 'medicine', 'computers',
  'piloting', 'bartending', 'engineering',
]

const FACTION_KEYS: FactionId[] = ['anaheim', 'civilian', 'federation', 'zeon']

// Derived accessors — computed from existing traits at requirement-read time.
// `daysAtFlopWithNoJob` is implemented via the slot's streakAnchorMs field
// in src/ecs/traits.ts; the system maintains the anchor.
const DERIVED_KEYS = ['aeRank', 'residenceTier', 'hasNoJob', 'hasNoHome', 'daysAtFlopWithNoJob'] as const
export type DerivedKey = typeof DERIVED_KEYS[number]

export type RequirementKey = AttributeKey | SkillId | 'money' | FactionId | DerivedKey

const VALID_KEYS = new Set<string>([
  ...ATTRIBUTE_KEYS,
  ...SKILL_KEYS,
  'money',
  ...FACTION_KEYS,
  ...DERIVED_KEYS,
])

// Shorthand `key: number` is "value >= threshold". Object form supports both
// directions; designer can author lte for "must be at most" (e.g., dropout's
// poverty stage).
export type RequirementValue = number | { gte?: number; lte?: number }

export interface AmbitionStage {
  stageNameZh: string
  requirements: Record<string, RequirementValue>
  payoff: {
    titleZh: string
    logZh: string
    unlocks?: string[]
    // Ambition Points awarded on stage completion. Defaults to 1 if
    // omitted; recommended range is 1..4 scaled to stage difficulty
    // (see Design/social/ambitions.md). Cross-ambition unification:
    // bartender stages and warlord stages award AP on the same scale.
    ap?: number
  }
}

export interface AmbitionDef {
  id: string
  nameZh: string
  blurbZh: string
  conflicts: string[]
  stages: AmbitionStage[]
  warPayoff: string
}

interface AmbitionsFile {
  ambitions: AmbitionDef[]
}

const parsed = json5.parse(raw) as AmbitionsFile

function validate(file: AmbitionsFile): void {
  const seenIds = new Set<string>()
  for (const a of file.ambitions) {
    if (typeof a.id !== 'string' || !a.id) {
      throw new Error(`[ambitions] invalid id: ${JSON.stringify(a.id)}`)
    }
    if (seenIds.has(a.id)) {
      throw new Error(`[ambitions] duplicate id: ${a.id}`)
    }
    seenIds.add(a.id)
    if (typeof a.nameZh !== 'string' || !a.nameZh) {
      throw new Error(`[ambitions:${a.id}] missing nameZh`)
    }
    if (typeof a.blurbZh !== 'string' || !a.blurbZh) {
      throw new Error(`[ambitions:${a.id}] missing blurbZh`)
    }
    if (!Array.isArray(a.conflicts)) {
      throw new Error(`[ambitions:${a.id}] conflicts must be array`)
    }
    for (const c of a.conflicts) {
      if (typeof c !== 'string') {
        throw new Error(`[ambitions:${a.id}] conflict id must be string: ${JSON.stringify(c)}`)
      }
    }
    if (typeof a.warPayoff !== 'string' || !a.warPayoff) {
      throw new Error(`[ambitions:${a.id}] missing warPayoff`)
    }
    if (!Array.isArray(a.stages) || a.stages.length === 0) {
      throw new Error(`[ambitions:${a.id}] must have at least one stage`)
    }
    const seenStageNames = new Set<string>()
    a.stages.forEach((s, i) => {
      if (typeof s.stageNameZh !== 'string' || !s.stageNameZh) {
        throw new Error(`[ambitions:${a.id}#${i}] missing stageNameZh`)
      }
      if (seenStageNames.has(s.stageNameZh)) {
        throw new Error(`[ambitions:${a.id}#${i}] duplicate stageNameZh: ${s.stageNameZh}`)
      }
      seenStageNames.add(s.stageNameZh)
      if (typeof s.requirements !== 'object' || s.requirements === null) {
        throw new Error(`[ambitions:${a.id}#${i}] requirements must be object`)
      }
      for (const [k, v] of Object.entries(s.requirements)) {
        if (!VALID_KEYS.has(k)) {
          throw new Error(`[ambitions:${a.id}#${i}] unknown requirement key: ${k}`)
        }
        if (typeof v !== 'number') {
          if (typeof v !== 'object' || v === null) {
            throw new Error(`[ambitions:${a.id}#${i}.${k}] requirement value must be number or {gte?, lte?}`)
          }
          const obj = v as { gte?: number; lte?: number }
          if (obj.gte === undefined && obj.lte === undefined) {
            throw new Error(`[ambitions:${a.id}#${i}.${k}] requirement object needs gte and/or lte`)
          }
          if (obj.gte !== undefined && typeof obj.gte !== 'number') {
            throw new Error(`[ambitions:${a.id}#${i}.${k}] gte must be number`)
          }
          if (obj.lte !== undefined && typeof obj.lte !== 'number') {
            throw new Error(`[ambitions:${a.id}#${i}.${k}] lte must be number`)
          }
        }
      }
      if (!s.payoff || typeof s.payoff !== 'object') {
        throw new Error(`[ambitions:${a.id}#${i}] missing payoff`)
      }
      if (typeof s.payoff.titleZh !== 'string' || !s.payoff.titleZh) {
        throw new Error(`[ambitions:${a.id}#${i}] missing payoff.titleZh`)
      }
      if (typeof s.payoff.logZh !== 'string' || !s.payoff.logZh) {
        throw new Error(`[ambitions:${a.id}#${i}] missing payoff.logZh`)
      }
      if (s.payoff.unlocks !== undefined) {
        if (!Array.isArray(s.payoff.unlocks)) {
          throw new Error(`[ambitions:${a.id}#${i}] unlocks must be array`)
        }
        for (const u of s.payoff.unlocks) {
          if (typeof u !== 'string' || !u) {
            throw new Error(`[ambitions:${a.id}#${i}] unlock flag must be non-empty string`)
          }
        }
      }
      if (s.payoff.ap !== undefined) {
        if (typeof s.payoff.ap !== 'number' || s.payoff.ap < 0 || !Number.isFinite(s.payoff.ap)) {
          throw new Error(`[ambitions:${a.id}#${i}] payoff.ap must be a non-negative finite number`)
        }
      }
    })
  }

  // Cross-check: conflicts reference real ambition ids.
  for (const a of file.ambitions) {
    for (const c of a.conflicts) {
      if (!seenIds.has(c)) {
        throw new Error(`[ambitions:${a.id}] conflict references unknown ambition: ${c}`)
      }
    }
  }
}

validate(parsed)

export const ambitions: readonly AmbitionDef[] = parsed.ambitions

export function getAmbition(id: string): AmbitionDef | undefined {
  return ambitions.find((a) => a.id === id)
}

// Normalize a requirement value to {gte, lte}. Shorthand number → {gte: n}.
export function normalizeRequirement(v: RequirementValue): { gte?: number; lte?: number } {
  if (typeof v === 'number') return { gte: v }
  return v
}

export function requirementSatisfied(currentValue: number, v: RequirementValue): boolean {
  const r = normalizeRequirement(v)
  if (r.gte !== undefined && currentValue < r.gte) return false
  if (r.lte !== undefined && currentValue > r.lte) return false
  return true
}
