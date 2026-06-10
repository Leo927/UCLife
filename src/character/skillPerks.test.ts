import { describe, it, expect } from 'vitest'
import { createWorld } from 'koota'
import {
  pendingTiers, pickSkillPerk, pickedOptionId, hasUnlock, respecCost,
  respecSkillPerk, respecCountOf, allPicks, tierOptions, skillPerkEffect,
} from './skillPerks'
import { skillPerksConfig } from '../config/skill-perks'
import { setSkillXp } from './skills'
import { skillsConfig } from '../config'
import { Attributes, Effects, SkillPerkState } from '../ecs/traits'
import { addEffect } from './effects'
import { getStat } from '../stats/sheet'
import { STAT_IDS } from '../stats/schema'

const XP = skillsConfig.xpPerLevel
const [TIER1, TIER2] = skillPerksConfig.tiers

function makeCharacter() {
  const world = createWorld()
  return world.spawn(Attributes, Effects, SkillPerkState)
}

describe('catalog authoring contract (Design/characters/skills.md § Data)', () => {
  it('every authored tier offers ≥2 options, ≥1 of them unlocks- or abilities-bearing', () => {
    for (const [skill, tiers] of Object.entries(skillPerksConfig.catalog)) {
      for (const [tier, options] of Object.entries(tiers)) {
        expect(
          options.length,
          `${skill}:${tier} must offer at least 2 mutually-exclusive options`,
        ).toBeGreaterThanOrEqual(2)
        const gameplayChanging = options.filter(
          (o) => (o.unlocks?.length ?? 0) > 0 || (o.abilities?.length ?? 0) > 0,
        )
        expect(
          gameplayChanging.length,
          `${skill}:${tier} is all-multiplier — every tier must offer ≥1 unlocks/abilities option`,
        ).toBeGreaterThanOrEqual(1)
        const ids = new Set(options.map((o) => o.id))
        expect(ids.size, `${skill}:${tier} has duplicate option ids`).toBe(options.length)
      }
    }
  })

  it('every modifier row names a real StatId and a real ModType', () => {
    // Config sits below stats in the layer order, so catalog rows are
    // structural strings — this test is the typo guard.
    const VALID_STAT_IDS = new Set<string>(STAT_IDS)
    const VALID_MOD_TYPES = new Set(['flat', 'percentAdd', 'percentMult', 'floor', 'cap'])
    for (const [skill, tiers] of Object.entries(skillPerksConfig.catalog)) {
      for (const [tier, options] of Object.entries(tiers)) {
        for (const o of options) {
          for (const m of o.modifiers ?? []) {
            expect(VALID_STAT_IDS.has(m.statId), `${skill}:${tier}:${o.id} statId "${m.statId}" is not a StatId`).toBe(true)
            expect(VALID_MOD_TYPES.has(m.type), `${skill}:${tier}:${o.id} mod type "${m.type}" is not a ModType`).toBe(true)
            expect(Number.isFinite(m.value), `${skill}:${tier}:${o.id} modifier value must be finite`).toBe(true)
          }
        }
      }
    }
  })

  it('authored tiers are exactly the configured milestone levels', () => {
    for (const [skill, tiers] of Object.entries(skillPerksConfig.catalog)) {
      for (const tier of Object.keys(tiers)) {
        expect(
          skillPerksConfig.tiers.map(String),
          `${skill} authors tier "${tier}" which is not a milestone level`,
        ).toContain(tier)
      }
    }
  })

  it('placeholder skills (marksmanship / piloting) carry placeholder rows at both tiers', () => {
    for (const skill of ['marksmanship', 'piloting'] as const) {
      for (const tier of skillPerksConfig.tiers) {
        const options = tierOptions(skill, tier)
        expect(options.length).toBeGreaterThanOrEqual(2)
        for (const o of options) {
          expect(o.unlocks?.[0]).toMatch(new RegExp(`^placeholder:${skill}:${tier}:`))
        }
      }
    }
  })
})

describe('milestone math — pendingTiers', () => {
  it('a tier becomes pending exactly when its level is reached', () => {
    const c = makeCharacter()
    expect(pendingTiers(c)).toEqual([])
    setSkillXp(c, 'cooking', (TIER1 - 1) * XP)
    expect(pendingTiers(c), 'level 29 must not unlock the tier-30 pick').toEqual([])
    setSkillXp(c, 'cooking', TIER1 * XP)
    const pending = pendingTiers(c)
    expect(pending).toHaveLength(1)
    expect(pending[0].skill).toBe('cooking')
    expect(pending[0].tier).toBe(TIER1)
    expect(pending[0].options.length).toBeGreaterThanOrEqual(2)
  })

  it('crossing the second milestone queues both unpicked tiers', () => {
    const c = makeCharacter()
    setSkillXp(c, 'cooking', TIER2 * XP)
    const pending = pendingTiers(c)
    expect(pending.map((p) => p.tier)).toEqual([TIER1, TIER2])
  })

  it('a committed pick clears its tier from the queue', () => {
    const c = makeCharacter()
    setSkillXp(c, 'cooking', TIER1 * XP)
    const opt = tierOptions('cooking', TIER1)[0]
    expect(pickSkillPerk(c, 'cooking', TIER1, opt.id)).toBe(true)
    expect(pendingTiers(c)).toEqual([])
    expect(pickedOptionId(c, 'cooking', TIER1)).toBe(opt.id)
  })
})

describe('pick — guards + fold', () => {
  it('refuses picks below the tier level, for unknown options, and for taken slots', () => {
    const c = makeCharacter()
    expect(pickSkillPerk(c, 'cooking', TIER1, 'meal_prep'), 'below level').toBe(false)
    setSkillXp(c, 'cooking', TIER1 * XP)
    expect(pickSkillPerk(c, 'cooking', TIER1, 'nonexistent'), 'unknown option').toBe(false)
    expect(pickSkillPerk(c, 'cooking', TIER1, 'meal_prep')).toBe(true)
    expect(pickSkillPerk(c, 'cooking', TIER1, 'gourmand'), 'slot already taken').toBe(false)
  })

  it('a modifier-bearing pick folds onto the StatSheet', () => {
    const c = makeCharacter()
    setSkillXp(c, 'mechanics', TIER1 * XP)
    const before = getStat(c.get(Attributes)!.sheet, 'workingSpeed')
    expect(pickSkillPerk(c, 'mechanics', TIER1, 'tinkerer')).toBe(true)
    const after = getStat(c.get(Attributes)!.sheet, 'workingSpeed')
    const opt = tierOptions('mechanics', TIER1).find((o) => o.id === 'tinkerer')!
    expect(after).toBeCloseTo(before * (1 + opt.modifiers![0].value))
  })

  it('unlocks flags are queryable and idempotent across sources', () => {
    const c = makeCharacter()
    setSkillXp(c, 'cooking', TIER1 * XP)
    expect(hasUnlock(c, 'recipe:premium_meal')).toBe(false)
    expect(pickSkillPerk(c, 'cooking', TIER1, 'gourmand')).toBe(true)
    expect(hasUnlock(c, 'recipe:premium_meal')).toBe(true)
    // A second source granting the same flag: possession stays binary,
    // and removing one source leaves the other's grant intact.
    addEffect(c, {
      id: 'perk:test_gourmet_voucher',
      originId: 'test_gourmet_voucher',
      family: 'perk',
      modifiers: [],
      unlocks: ['recipe:premium_meal'],
    })
    expect(hasUnlock(c, 'recipe:premium_meal')).toBe(true)
    expect(respecSkillPerk(c, 'cooking', TIER1)).toBe(true)
    expect(hasUnlock(c, 'recipe:premium_meal'), 'other source still grants the flag').toBe(true)
  })

  it('skillPerkEffect reserves the abilities payload verbatim', () => {
    const fieldEngineer = tierOptions('mechanics', TIER2).find((o) => o.id === 'field_engineer')!
    const eff = skillPerkEffect('mechanics', TIER2, fieldEngineer)
    expect(eff.family).toBe('skill_perk')
    expect(eff.abilities).toEqual(fieldEngineer.abilities)
  })
})

describe('respec — slot refund + cost curve', () => {
  it('refunds the slot (tier pending again) and unwinds modifiers', () => {
    const c = makeCharacter()
    setSkillXp(c, 'mechanics', TIER1 * XP)
    const base = getStat(c.get(Attributes)!.sheet, 'workingSpeed')
    pickSkillPerk(c, 'mechanics', TIER1, 'tinkerer')
    expect(respecSkillPerk(c, 'mechanics', TIER1)).toBe(true)
    expect(getStat(c.get(Attributes)!.sheet, 'workingSpeed')).toBeCloseTo(base)
    expect(pickedOptionId(c, 'mechanics', TIER1)).toBeNull()
    expect(pendingTiers(c).map((p) => `${p.skill}:${p.tier}`)).toContain(`mechanics:${TIER1}`)
    expect(respecCountOf(c)).toBe(1)
    expect(respecSkillPerk(c, 'mechanics', TIER1), 'nothing left to refund').toBe(false)
  })

  it('cost grows strictly monotonically with prior respec count, money dominant', () => {
    const c0 = respecCost(0)
    const c1 = respecCost(1)
    const c2 = respecCost(2)
    expect(c1.money).toBeGreaterThan(c0.money)
    expect(c2.money).toBeGreaterThan(c1.money)
    expect(c1.days).toBeGreaterThan(c0.days)
    expect(c2.days).toBeGreaterThan(c1.days)
  })

  it('allPicks lists committed picks for the Tutor respec menu', () => {
    const c = makeCharacter()
    setSkillXp(c, 'cooking', TIER2 * XP)
    pickSkillPerk(c, 'cooking', TIER1, 'meal_prep')
    pickSkillPerk(c, 'cooking', TIER2, 'batch_feast')
    expect(allPicks(c)).toEqual([
      { skill: 'cooking', tier: TIER1, optionId: 'meal_prep', nameZh: '备餐高手' },
      { skill: 'cooking', tier: TIER2, optionId: 'batch_feast', nameZh: '流水后厨' },
    ])
  })
})
