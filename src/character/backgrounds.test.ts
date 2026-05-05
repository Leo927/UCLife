import { describe, expect, it } from 'vitest'
import { BACKGROUNDS, getBackground, backgroundSource } from './backgrounds'
import { createCharacterSheet, type StatId } from '../stats/schema'
import { addModifier, getStat, removeBySource, type Modifier } from '../stats/sheet'

// Catalog-shape pinning. The application path goes through a koota
// entity so it's covered by smoke tests; here we verify the data
// schema and the modifier math each background produces against an
// isolated sheet.

describe('backgrounds catalog', () => {
  it('non-empty and statics are unique by id', () => {
    expect(BACKGROUNDS.length).toBeGreaterThan(0)
    const ids = new Set(BACKGROUNDS.map((b) => b.id))
    expect(ids.size).toBe(BACKGROUNDS.length)
  })

  it('every entry has at least one modifier', () => {
    for (const bg of BACKGROUNDS) expect(bg.modifiers.length).toBeGreaterThan(0)
  })
})

describe('backgroundSource', () => {
  it('namespaces with the bg: prefix', () => {
    expect(backgroundSource('soldier')).toBe('bg:soldier')
  })
})

describe('soldier background math', () => {
  const def = getBackground('soldier')!
  it('exists in the catalog', () => {
    expect(def).toBeDefined()
  })

  it('applied to a fresh sheet adds the listed flats and percent mods', () => {
    let s = createCharacterSheet()
    const source = backgroundSource('soldier')
    for (const m of def.modifiers) {
      const mod: Modifier<StatId> = { statId: m.statId, type: m.type, value: m.value, source }
      s = addModifier(s, mod)
    }
    // 6 attribute base = 50; soldier adds +10 strength, +10 endurance, +5 reflex.
    expect(getStat(s, 'strength')).toBe(60)
    expect(getStat(s, 'endurance')).toBe(60)
    expect(getStat(s, 'reflex')).toBe(55)
    // boredomDrainMul base 1, +20% percentMult → 1.20.
    expect(getStat(s, 'boredomDrainMul')).toBeCloseTo(1.2, 6)
  })

  it('removeBySource(bg:soldier) restores the sheet', () => {
    let s = createCharacterSheet()
    const source = backgroundSource('soldier')
    for (const m of def.modifiers) {
      s = addModifier(s, { statId: m.statId, type: m.type, value: m.value, source })
    }
    s = removeBySource(s, source)
    expect(getStat(s, 'strength')).toBe(50)
    expect(getStat(s, 'endurance')).toBe(50)
    expect(getStat(s, 'reflex')).toBe(50)
    expect(getStat(s, 'boredomDrainMul')).toBe(1)
  })
})
