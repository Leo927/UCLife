import json5 from 'json5'
import raw from './perks.json5?raw'
import type { SkillId } from './skills'

// Sims-style aspiration-reward catalog. Player spends Ambition Points
// (AP) earned from any ambition's stage payoffs on perks from this
// universal list. Permanent once purchased — no respec.

export type PerkCategory = 'vital' | 'skill' | 'social' | 'economic' | 'combat' | 'faction'

export type VitalKey = 'hunger' | 'thirst' | 'fatigue' | 'hygiene' | 'boredom' | 'all'

export type PerkEffect =
  | { kind: 'vitalDecay'; vital: VitalKey; mul: number }
  | { kind: 'skillXpMul'; skill: SkillId; mul: number }
  | { kind: 'wageMul'; mul: number }
  | { kind: 'shopDiscountMul'; mul: number }
  | { kind: 'rentMul'; mul: number }
  // Scaffolded effects whose downstream consumers haven't shipped yet —
  // Phase 5.2 (relations) and Phase 6.1 (combat) will replace these
  // with concrete kinds. Keeping them as 'placeholder' lets the perk
  // catalog ship without a partial-effect implementation.
  | { kind: 'placeholder' }

export interface PerkDef {
  id: string
  nameZh: string
  descZh: string
  apCost: number
  category: PerkCategory
  effect: PerkEffect
}

interface PerksFile {
  perks: PerkDef[]
}

const parsed = json5.parse(raw) as PerksFile

const VALID_CATEGORIES: ReadonlySet<PerkCategory> = new Set<PerkCategory>([
  'vital', 'skill', 'social', 'economic', 'combat', 'faction',
])
const VALID_SKILLS: ReadonlySet<SkillId> = new Set<SkillId>([
  'mechanics', 'marksmanship', 'athletics', 'cooking', 'medicine', 'computers',
  'piloting', 'bartending', 'engineering',
])
const VALID_VITALS: ReadonlySet<VitalKey> = new Set<VitalKey>([
  'hunger', 'thirst', 'fatigue', 'hygiene', 'boredom', 'all',
])

const seen = new Set<string>()
for (const p of parsed.perks) {
  if (!p.id) throw new Error('perks.json5: perk missing id')
  if (seen.has(p.id)) throw new Error(`perks.json5: duplicate perk id "${p.id}"`)
  seen.add(p.id)
  if (!p.nameZh) throw new Error(`perks.json5: perk "${p.id}" missing nameZh`)
  if (typeof p.apCost !== 'number' || p.apCost <= 0) {
    throw new Error(`perks.json5: perk "${p.id}" apCost must be > 0`)
  }
  if (!VALID_CATEGORIES.has(p.category)) {
    throw new Error(`perks.json5: perk "${p.id}" invalid category "${p.category}"`)
  }
  switch (p.effect.kind) {
    case 'vitalDecay':
      if (!VALID_VITALS.has(p.effect.vital)) {
        throw new Error(`perks.json5: perk "${p.id}" invalid vital "${p.effect.vital}"`)
      }
      if (p.effect.mul <= 0) {
        throw new Error(`perks.json5: perk "${p.id}" vitalDecay.mul must be > 0`)
      }
      break
    case 'skillXpMul':
      if (!VALID_SKILLS.has(p.effect.skill)) {
        throw new Error(`perks.json5: perk "${p.id}" invalid skill "${p.effect.skill}"`)
      }
      if (p.effect.mul <= 0) {
        throw new Error(`perks.json5: perk "${p.id}" skillXpMul.mul must be > 0`)
      }
      break
    case 'wageMul':
    case 'shopDiscountMul':
    case 'rentMul':
      if (p.effect.mul <= 0) {
        throw new Error(`perks.json5: perk "${p.id}" ${p.effect.kind}.mul must be > 0`)
      }
      break
    case 'placeholder':
      break
  }
}

export const PERKS: readonly PerkDef[] = parsed.perks

const byId: Record<string, PerkDef> = Object.fromEntries(parsed.perks.map((p) => [p.id, p]))

export function getPerk(id: string): PerkDef | undefined {
  return byId[id]
}

export function isPerkId(id: string): boolean {
  return id in byId
}
