import { describe, expect, it } from 'vitest'
import { createCharacterSheet, vitalDrainMulStat } from './schema'
import { addModifier, getStat, removeBySource, type Modifier } from './sheet'
import type { StatId } from './schema'

// perkSync.ts itself touches a koota world via Attributes, which is hard
// to instantiate from a unit test. The behavior worth pinning is the
// modifier math — once the sync function pushes the right modifiers,
// these tests show the sheet computes the expected drain multipliers.

// Pulled out of perkSync.ts so the test doesn't need a koota world.
// Reproduces the inner loop's collect-then-strip pass against a sheet
// directly.
function stripAllPerkSources<T extends Modifier<StatId>>(sheet0: ReturnType<typeof createCharacterSheet>): ReturnType<typeof createCharacterSheet> {
  const sources = new Set<string>()
  for (const id of Object.keys(sheet0.stats) as StatId[]) {
    for (const m of sheet0.stats[id].modifiers) {
      if (m.source.startsWith('perk:')) sources.add(m.source)
    }
  }
  let s = sheet0
  for (const src of sources) s = removeBySource(s, src)
  void ({} as T)
  return s
}

describe('strip-all-perk-sources regression', () => {
  it('removes every perk modifier on a stat that has multiple perk sources', () => {
    let s = createCharacterSheet()
    s = addModifier(s, { statId: 'hungerDrainMul', type: 'percentMult', value: -0.20, source: 'perk:a' })
    s = addModifier(s, { statId: 'hungerDrainMul', type: 'percentMult', value: -0.10, source: 'perk:b' })
    s = stripAllPerkSources(s)
    // Both perks gone; the base 1.0 must be intact.
    expect(getStat(s, 'hungerDrainMul')).toBe(1)
  })
})

describe('vitalDecay → DrainMul modifier math', () => {
  it('a 0.8 perk on hunger reduces hungerDrainMul to 0.8', () => {
    let s = createCharacterSheet()
    const mod: Modifier<StatId> = {
      statId: vitalDrainMulStat('hunger'),
      type: 'percentMult',
      value: -0.2, // 0.8 - 1
      source: 'perk:slow-hunger',
    }
    s = addModifier(s, mod)
    expect(getStat(s, 'hungerDrainMul')).toBeCloseTo(0.8, 6)
  })

  it("the 'all' perk stacks across every vital", () => {
    let s = createCharacterSheet()
    for (const v of ['hunger', 'thirst', 'fatigue', 'hygiene', 'boredom'] as const) {
      s = addModifier(s, {
        statId: vitalDrainMulStat(v),
        type: 'percentMult',
        value: -0.10,
        source: 'perk:long-distance',
      })
    }
    expect(getStat(s, 'hungerDrainMul')).toBeCloseTo(0.9, 6)
    expect(getStat(s, 'fatigueDrainMul')).toBeCloseTo(0.9, 6)
  })

  it('removeBySource(perk:*) clears just that perk', () => {
    let s = createCharacterSheet()
    s = addModifier(s, { statId: vitalDrainMulStat('hunger'), type: 'percentMult', value: -0.2, source: 'perk:a' })
    s = addModifier(s, { statId: vitalDrainMulStat('hunger'), type: 'percentMult', value: -0.1, source: 'perk:b' })
    expect(getStat(s, 'hungerDrainMul')).toBeCloseTo(0.72, 6)  // 0.8 * 0.9
    s = removeBySource(s, 'perk:a')
    expect(getStat(s, 'hungerDrainMul')).toBeCloseTo(0.9, 6)
  })
})
