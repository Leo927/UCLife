import type { Entity } from 'koota'
import { skillsConfig, type SkillId } from '../config'
import { Attributes } from '../ecs/traits'
import { getStat, setBase } from '../stats/sheet'

// Re-export so callers can keep importing SkillId from
// character/skills. Canonical declaration lives in config/skills.ts.
export type { SkillId }

export const SKILLS = skillsConfig.catalog
export const SKILL_ORDER: SkillId[] = skillsConfig.order

export const BOOK_CAP_XP = skillsConfig.bookCapLevel * skillsConfig.xpPerLevel

export function levelOf(xp: number): number {
  return Math.min(100, Math.floor(xp / skillsConfig.xpPerLevel))
}

export function progressInLevel(xp: number): number {
  return (xp % skillsConfig.xpPerLevel) / skillsConfig.xpPerLevel
}

// Skill XP lives on the StatSheet as a base value (the stat's modifiers
// list stays empty — XP is the integer that drifts up over time, with
// no perk/condition stacking on the level itself). XP-rate perks
// modify the sibling `<skill>XpMul` stat, which the grant-side reads.
export function getSkillXp(entity: Entity, skill: SkillId): number {
  const a = entity.get(Attributes)
  if (!a) return 0
  return getStat(a.sheet, skill)
}

export function setSkillXp(entity: Entity, skill: SkillId, xp: number): void {
  const a = entity.get(Attributes)
  if (!a) return
  const sheet = setBase(a.sheet, skill, xp)
  if (sheet !== a.sheet) entity.set(Attributes, { ...a, sheet })
}

export function addSkillXp(entity: Entity, skill: SkillId, delta: number): void {
  if (delta === 0) return
  const a = entity.get(Attributes)
  if (!a) return
  const cur = getStat(a.sheet, skill)
  const sheet = setBase(a.sheet, skill, cur + delta)
  entity.set(Attributes, { ...a, sheet })
}
