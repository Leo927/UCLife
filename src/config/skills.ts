import json5 from 'json5'
import raw from './skills.json5?raw'
import type { SkillId } from '../character/skills'

export interface SkillsConfig {
  catalog: Record<SkillId, { label: string; group: string }>
  order: SkillId[]
  xpPerLevel: number
  bookCapLevel: number
}

export const skillsConfig = json5.parse(raw) as SkillsConfig
