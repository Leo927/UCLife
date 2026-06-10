// Skill Perks — Design/characters/skills.md § Skill Perks (issue #142).
// Milestone picks at the configured tier levels, one option per (skill,
// tier), free of AP. The Effects list is the single source of truth: a
// pick is an Effect with id `skill_perk:<skill>:<tier>` whose originId
// names the chosen option, so "tier pending" is derived (level reached,
// no pick Effect) and never duplicated into separate bookkeeping.

import type { Entity } from 'koota'
import { Attributes, SkillPerkState } from '../ecs/traits'
import { skillPerksConfig, type SkillPerkOption } from '../config/skill-perks'
import { levelOf, getSkillXp, SKILL_ORDER, type SkillId } from './skills'
import type { Effect } from '../stats/effects'
import { addEffect, removeEffect, getEffects } from './effects'

export interface SkillPerkTierRef {
  skill: SkillId
  tier: number
  options: SkillPerkOption[]
}

function pickEffectId(skill: SkillId, tier: number): string {
  return `skill_perk:${skill}:${tier}`
}

export function tierOptions(skill: SkillId, tier: number): SkillPerkOption[] {
  return skillPerksConfig.catalog[skill]?.[String(tier)] ?? []
}

// The option id picked for (skill, tier), or null when the slot is open.
export function pickedOptionId(entity: Entity, skill: SkillId, tier: number): string | null {
  const id = pickEffectId(skill, tier)
  for (const e of getEffects(entity)) {
    if (e.id === id) return e.originId
  }
  return null
}

// Tiers whose level threshold is reached but whose slot is unpicked —
// the forced-pick queue the skill panel must resolve. Read on panel
// open / respec, never per tick.
export function pendingTiers(entity: Entity): SkillPerkTierRef[] {
  if (!entity.has(Attributes)) return []
  const out: SkillPerkTierRef[] = []
  for (const skill of SKILL_ORDER) {
    const level = levelOf(getSkillXp(entity, skill))
    for (const tier of skillPerksConfig.tiers) {
      if (level < tier) break
      const options = tierOptions(skill, tier)
      if (options.length === 0) continue
      if (pickedOptionId(entity, skill, tier) !== null) continue
      out.push({ skill, tier, options })
    }
  }
  return out
}

export function skillPerkEffect(skill: SkillId, tier: number, option: SkillPerkOption): Effect {
  return {
    id: pickEffectId(skill, tier),
    originId: option.id,
    family: 'skill_perk',
    // Config is layered below stats, so its modifier rows are structural
    // strings — narrowed here at the Effect boundary; the catalog
    // validation test guards against statId / type typos.
    modifiers: (option.modifiers ?? []).map((m) => ({ ...m })) as Effect['modifiers'],
    unlocks: option.unlocks ? [...option.unlocks] : undefined,
    abilities: option.abilities?.map((a) => ({ ...a })) ?? undefined,
    nameZh: option.nameZh,
    descZh: option.descZh,
  }
}

// Commit a milestone pick. Refuses when the level isn't reached, the
// option doesn't exist, or the slot is already taken (respec first).
export function pickSkillPerk(
  entity: Entity, skill: SkillId, tier: number, optionId: string,
): boolean {
  if (!entity.has(Attributes)) return false
  if (levelOf(getSkillXp(entity, skill)) < tier) return false
  if (pickedOptionId(entity, skill, tier) !== null) return false
  const option = tierOptions(skill, tier).find((o) => o.id === optionId)
  if (!option) return false
  return addEffect(entity, skillPerkEffect(skill, tier, option))
}

// Passive unlock-flag query (Design/characters/skills.md § Data, payload
// kind 2). Scans every Effect regardless of family so a skill perk and a
// future ambition perk granting the same flag stay idempotent.
export function hasUnlock(entity: Entity, flag: string): boolean {
  for (const e of getEffects(entity)) {
    if (e.unlocks?.includes(flag)) return true
  }
  return false
}

export interface RespecCost {
  money: number
  days: number
}

// money = base × growth^n, days = base + perRespec × n; n = prior respecs.
export function respecCost(priorRespecCount: number): RespecCost {
  const r = skillPerksConfig.respec
  return {
    money: Math.round(r.moneyBase * Math.pow(r.moneyGrowth, priorRespecCount)),
    days: r.daysBase + r.daysPerRespec * priorRespecCount,
  }
}

export function respecCountOf(entity: Entity): number {
  return entity.has(SkillPerkState) ? entity.get(SkillPerkState)!.respecCount : 0
}

// Refund the (skill, tier) slot: the pick's Effect (modifiers + unlocks)
// is removed and the tier becomes pending again, forcing a re-pick on
// the next skill-panel open. Charging money / advancing days is the
// caller's job (the Tutor branch) — this only mutates perk state.
export function respecSkillPerk(entity: Entity, skill: SkillId, tier: number): boolean {
  if (pickedOptionId(entity, skill, tier) === null) return false
  if (!removeEffect(entity, pickEffectId(skill, tier))) return false
  if (!entity.has(SkillPerkState)) entity.add(SkillPerkState)
  const s = entity.get(SkillPerkState)!
  entity.set(SkillPerkState, { respecCount: s.respecCount + 1 })
  return true
}

// Every committed pick, for the Tutor's respec list + save inspection.
export function allPicks(
  entity: Entity,
): Array<{ skill: SkillId; tier: number; optionId: string; nameZh: string }> {
  const out: Array<{ skill: SkillId; tier: number; optionId: string; nameZh: string }> = []
  for (const skill of SKILL_ORDER) {
    for (const tier of skillPerksConfig.tiers) {
      const optionId = pickedOptionId(entity, skill, tier)
      if (optionId === null) continue
      const option = tierOptions(skill, tier).find((o) => o.id === optionId)
      out.push({ skill, tier, optionId, nameZh: option?.nameZh ?? optionId })
    }
  }
  return out
}
