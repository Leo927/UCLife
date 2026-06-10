import { describe, it, expect } from 'vitest'
import {
  temperamentEffect, sympathyEffect, generatePsychologyForName,
  psychologyForName, causeReaction, nextRevealableCause,
} from './psychology'
import { psychologyConfig, CAUSE_IDS, TEMPERAMENT_IDS } from '../config/psychology'
import { createCharacterSheet, sympathyStat } from '../stats/schema'
import { applyEffectToSheet } from '../stats/effects'
import { getStat } from '../stats/sheet'

describe('causeReaction — dot(causeTags, sympathies) × temperamentScale', () => {
  it('scales a single matching tag by sympathy weight and reactionScale', () => {
    let sheet = createCharacterSheet()
    sheet = applyEffectToSheet(sheet, sympathyEffect('zeonism', 0.8))
    sheet = applyEffectToSheet(sheet, temperamentEffect('proud'))
    const proudScale = 1 + psychologyConfig.temperaments.proud.reactionScaleDelta
    expect(causeReaction(sheet, { zeonism: 1 })).toBeCloseTo(0.8 * proudScale)
  })

  it('sums multiple tags, antagonized causes subtracting', () => {
    let sheet = createCharacterSheet()
    sheet = applyEffectToSheet(sheet, sympathyEffect('zeonism', 0.5))
    sheet = applyEffectToSheet(sheet, sympathyEffect('pacifism', -0.4))
    // Neutral temperament: reactionScale stays at its base of 1.
    expect(causeReaction(sheet, { zeonism: 1, pacifism: 1 })).toBeCloseTo(0.5 - 0.4)
    expect(causeReaction(sheet, { zeonism: -1 })).toBeCloseTo(-0.5)
  })

  it('returns 0 when the character holds no sympathy on any tagged cause', () => {
    const sheet = createCharacterSheet()
    expect(causeReaction(sheet, { federation_order: 1 })).toBe(0)
  })
})

describe('generatePsychologyForName — deterministic procgen', () => {
  it('is stable for the same name and differs across names', () => {
    const a1 = generatePsychologyForName('李明')
    const a2 = generatePsychologyForName('李明')
    expect(a2).toEqual(a1)
    const names = ['李明', '王芳', '张伟', '陈静', '刘洋']
    const distinct = new Set(names.map((n) => JSON.stringify(generatePsychologyForName(n))))
    expect(distinct.size, 'five names should not all roll identical psychology').toBeGreaterThan(1)
  })

  it('respects the configured count and magnitude envelope', () => {
    const cfg = psychologyConfig.procgen
    for (const name of ['李明', '王芳', '张伟', '陈静', '刘洋', '杨光', '赵磊']) {
      const psy = generatePsychologyForName(name)
      expect(TEMPERAMENT_IDS).toContain(psy.temperament)
      const entries = Object.entries(psy.sympathies)
      expect(entries.length).toBeGreaterThanOrEqual(cfg.sympathyCountMin)
      expect(entries.length).toBeLessThanOrEqual(cfg.sympathyCountMax)
      for (const [cause, w] of entries) {
        expect(CAUSE_IDS).toContain(cause)
        expect(Math.abs(w!)).toBeGreaterThanOrEqual(cfg.magnitudeMin)
        expect(Math.abs(w!)).toBeLessThanOrEqual(cfg.magnitudeMax)
      }
    }
  })

  it('folds onto the sheet via sympathy Effects', () => {
    const psy = generatePsychologyForName('李明')
    let sheet = createCharacterSheet()
    for (const [cause, w] of Object.entries(psy.sympathies)) {
      sheet = applyEffectToSheet(sheet, sympathyEffect(cause as never, w!))
    }
    for (const [cause, w] of Object.entries(psy.sympathies)) {
      expect(getStat(sheet, sympathyStat(cause as never))).toBeCloseTo(w!)
    }
  })
})

describe('psychologyForName — authored special NPCs override procgen', () => {
  it('returns the authored values for an authored name', () => {
    // 米利亚·卡里 (AE chair) carries authored psychology in special-npcs.json5.
    const psy = psychologyForName('米利亚·卡里')
    expect(psy.temperament).toBe('pragmatic')
    expect(psy.sympathies.ae_pragmatism).toBeCloseTo(0.9)
  })
})

describe('nextRevealableCause — highest magnitude first, deterministic', () => {
  it('orders by |weight| descending across successive reveals', () => {
    const sym = { zeonism: 0.8, pacifism: -0.4, ae_pragmatism: 0.3 }
    const revealed: string[] = []
    const order: string[] = []
    for (;;) {
      const next = nextRevealableCause(sym, revealed)
      if (!next) break
      order.push(next)
      revealed.push(next)
    }
    expect(order).toEqual(['zeonism', 'pacifism', 'ae_pragmatism'])
  })

  it('breaks magnitude ties by CAUSE_IDS declaration order', () => {
    expect(nextRevealableCause({ pacifism: 0.4, federation_order: -0.4 }, []))
      .toBe('federation_order')
  })

  it('returns null once every held sympathy is known, skipping zero weights', () => {
    expect(nextRevealableCause({ zeonism: 0.5, pacifism: 0 }, ['zeonism'])).toBeNull()
    expect(nextRevealableCause({}, [])).toBeNull()
  })
})
