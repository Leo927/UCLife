import json5 from 'json5'
import raw from './skill-perks.json5?raw'
import type { SkillId } from './skills'

// Config is the lowest layer, so option shapes here are structural —
// statId / modifier-type strings are validated against the stats schema
// by skillPerks.test.ts (json5 content is never compile-checked anyway)
// and narrowed at the Effect boundary in character/skillPerks.ts.
export interface SkillPerkOption {
  // Unique within its (skill, tier) row; the full perk id is composed as
  // `<skill>:<tier>:<id>` (see character/skillPerks.ts).
  id: string
  nameZh: string
  descZh: string
  modifiers?: { statId: string; type: string; value: number }[]
  unlocks?: string[]
  abilities?: { id: string; cooldownSec: number }[]
}

export interface SkillPerksConfig {
  tiers: number[]
  respec: {
    moneyBase: number
    moneyGrowth: number
    daysBase: number
    daysPerRespec: number
  }
  // Skills without authored perks simply have no entry; tiers within a
  // skill are keyed by the stringified tier level.
  catalog: Partial<Record<SkillId, Record<string, SkillPerkOption[]>>>
}

export const skillPerksConfig = json5.parse(raw) as SkillPerksConfig
