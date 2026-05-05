import json5 from 'json5'
import raw from './skills.json5?raw'

// Canonical skill-id list. stats/schema.ts builds the StatSheet
// schema off this constant; character/skills.ts re-exports the
// derived type for upper-layer callers. Lives in config/ so config-
// layer schema files (jobs, actions) can reference SkillId without
// reaching upward into character/.
export const SKILL_IDS = [
  'mechanics', 'marksmanship', 'athletics', 'cooking', 'medicine',
  'computers', 'piloting', 'bartending', 'engineering',
] as const

export type SkillId = typeof SKILL_IDS[number]

export interface SkillsConfig {
  catalog: Record<SkillId, { label: string; group: string }>
  order: SkillId[]
  xpPerLevel: number
  bookCapLevel: number
}

export const skillsConfig = json5.parse(raw) as SkillsConfig
