import { skillsConfig } from '../config'

export type SkillId = 'mechanics' | 'marksmanship' | 'athletics' | 'cooking' | 'medicine' | 'computers'

export const SKILLS = skillsConfig.catalog
export const SKILL_ORDER: SkillId[] = skillsConfig.order

export const BOOK_CAP_XP = skillsConfig.bookCapLevel * skillsConfig.xpPerLevel

export function levelOf(xp: number): number {
  return Math.min(100, Math.floor(xp / skillsConfig.xpPerLevel))
}

export function progressInLevel(xp: number): number {
  return (xp % skillsConfig.xpPerLevel) / skillsConfig.xpPerLevel
}
