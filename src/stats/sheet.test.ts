// TDD coverage of the stat-sheet API ported from
// github.com/andykessler/CharacterStats. The reference uses C# events;
// we use a serializable POJO with a cacheVersion to detect dirtiness.
import { describe, expect, it } from 'vitest'
import {
  createSheet, getStat, setBase, addModifier, removeBySource,
  type StatSheet, type Modifier,
} from './sheet'

const STAT_TYPES = ['strength', 'dexterity', 'critHit'] as const
type TestStatId = typeof STAT_TYPES[number]

// Identity for non-derived stats; CritHit derives from Dexterity (mirrors
// the reference repo's StatFormulas.cs).
const TEST_FORMULAS = {
  strength: { deps: [] as TestStatId[], formula: (_s: StatSheet<TestStatId>, b: number) => b },
  dexterity: { deps: [] as TestStatId[], formula: (_s: StatSheet<TestStatId>, b: number) => b },
  critHit: { deps: ['dexterity'] as TestStatId[], formula: (s: StatSheet<TestStatId>, b: number) => b + 0.15 * getStat(s, 'dexterity') },
}

function makeSheet(): StatSheet<TestStatId> {
  return createSheet(STAT_TYPES, TEST_FORMULAS)
}

const flatMod = (statId: TestStatId, value: number, source: string): Modifier<TestStatId> => ({
  statId, type: 'flat', value, source,
})
const pctAddMod = (statId: TestStatId, value: number, source: string): Modifier<TestStatId> => ({
  statId, type: 'percentAdd', value, source,
})
const pctMulMod = (statId: TestStatId, value: number, source: string): Modifier<TestStatId> => ({
  statId, type: 'percentMult', value, source,
})

describe('createSheet', () => {
  it('seeds every stat type with a base of zero', () => {
    const s = makeSheet()
    for (const t of STAT_TYPES) expect(getStat(s, t)).toBe(0)
  })
})

describe('setBase', () => {
  it('replaces the base value used by formulas', () => {
    let s = makeSheet()
    s = setBase(s, 'strength', 50)
    expect(getStat(s, 'strength')).toBe(50)
  })

  it('returns a new snapshot — does not mutate the input', () => {
    const a = makeSheet()
    const b = setBase(a, 'strength', 50)
    expect(getStat(a, 'strength')).toBe(0)
    expect(getStat(b, 'strength')).toBe(50)
  })
})

describe('addModifier flat', () => {
  it('sums flat modifiers into the final value', () => {
    let s = setBase(makeSheet(), 'strength', 10)
    s = addModifier(s, flatMod('strength', 5, 'background:soldier'))
    s = addModifier(s, flatMod('strength', 3, 'item:belt'))
    expect(getStat(s, 'strength')).toBe(18)
  })
})

describe('addModifier percent', () => {
  it('treats percentAdd as a single shared bucket: (base+flat) * (1 + Σadd)', () => {
    let s = setBase(makeSheet(), 'strength', 100)
    s = addModifier(s, pctAddMod('strength', 0.10, 'a'))
    s = addModifier(s, pctAddMod('strength', 0.20, 'b'))
    expect(getStat(s, 'strength')).toBeCloseTo(130, 6)
  })

  it('treats percentMult as multiplicative: (base+flat)*(1+Σadd)*Π(1+mult)', () => {
    let s = setBase(makeSheet(), 'strength', 100)
    s = addModifier(s, pctMulMod('strength', 0.10, 'a'))
    s = addModifier(s, pctMulMod('strength', 0.10, 'b'))
    expect(getStat(s, 'strength')).toBeCloseTo(121, 6) // 100 * 1.10 * 1.10
  })

  it('combines flat + percentAdd + percentMult in the documented order', () => {
    let s = setBase(makeSheet(), 'strength', 100)
    s = addModifier(s, flatMod('strength', 20, 'a'))           // 120
    s = addModifier(s, pctAddMod('strength', 0.50, 'b'))       // 120 * 1.5 = 180
    s = addModifier(s, pctMulMod('strength', 0.10, 'c'))       // 180 * 1.1 = 198
    expect(getStat(s, 'strength')).toBeCloseTo(198, 6)
  })
})

describe('removeBySource', () => {
  it('removes every modifier from a single source across all stats', () => {
    let s = setBase(makeSheet(), 'strength', 10)
    s = setBase(s, 'dexterity', 10)
    s = addModifier(s, flatMod('strength', 5, 'background:soldier'))
    s = addModifier(s, flatMod('dexterity', 3, 'background:soldier'))
    s = addModifier(s, flatMod('strength', 7, 'item:belt'))
    s = removeBySource(s, 'background:soldier')
    expect(getStat(s, 'strength')).toBe(17)  // 10 + 7 (belt)
    expect(getStat(s, 'dexterity')).toBe(10) // background gone
  })

  it('is a no-op when the source has no modifiers', () => {
    let s = addModifier(setBase(makeSheet(), 'strength', 10), flatMod('strength', 5, 'a'))
    const before = getStat(s, 'strength')
    s = removeBySource(s, 'never-existed')
    expect(getStat(s, 'strength')).toBe(before)
  })
})

describe('derived formulas', () => {
  it('recomputes when a dependency changes', () => {
    let s = setBase(makeSheet(), 'dexterity', 100)
    expect(getStat(s, 'critHit')).toBeCloseTo(15, 6) // 0 + 0.15 * 100
    s = setBase(s, 'dexterity', 60)
    expect(getStat(s, 'critHit')).toBeCloseTo(9, 6)  // 0 + 0.15 * 60
  })

  it('a modifier on the dependency propagates through the formula', () => {
    let s = setBase(makeSheet(), 'dexterity', 50)
    s = addModifier(s, flatMod('dexterity', 50, 'item:gloves'))
    // dexterity = 100, critHit = 0 + 0.15 * 100 = 15
    expect(getStat(s, 'critHit')).toBeCloseTo(15, 6)
  })
})

describe('value caching', () => {
  it('returns identical numeric results across repeated reads', () => {
    let s = setBase(makeSheet(), 'strength', 73)
    s = addModifier(s, pctMulMod('strength', 0.07, 'a'))
    const v1 = getStat(s, 'strength')
    const v2 = getStat(s, 'strength')
    const v3 = getStat(s, 'strength')
    expect(v1).toBe(v2)
    expect(v2).toBe(v3)
  })

  it('rounds to 4 decimals to mask float-arithmetic noise', () => {
    let s = setBase(makeSheet(), 'strength', 0.1)
    s = addModifier(s, flatMod('strength', 0.2, 'a'))
    // raw 0.1 + 0.2 = 0.30000000000000004 — should round to 0.3.
    expect(getStat(s, 'strength')).toBe(0.3)
  })
})

describe('serialization', () => {
  it('survives JSON round-trip — sheets are POJO', () => {
    let s = setBase(makeSheet(), 'strength', 50)
    s = addModifier(s, flatMod('strength', 10, 'item:belt'))
    s = addModifier(s, pctMulMod('strength', 0.10, 'perk:strong'))
    // The formula table holds non-serializable functions; serializeSheet
    // strips it and attachFormulas rebuilds.
    const round = JSON.parse(JSON.stringify({ stats: s.stats, version: s.version }))
    round.formulas = TEST_FORMULAS
    expect(getStat(round, 'strength')).toBe(getStat(s, 'strength'))
  })
})
