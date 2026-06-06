// refusalChance — the pure stat-check core of the conscription refusal roll.
// Drives the modifier math + clamping off the real config without a world.

import { describe, expect, it } from 'vitest'
import { refusalChance, type RefusalInputs } from './conscription'
import { conscriptionConfig } from '../config'

const NONE: RefusalInputs = {
  federationRep: 0,
  charisma: 0,
  medicalLetter: false,
  bribe: false,
  proPilotAmbition: false,
}

const c = conscriptionConfig.refusal

describe('refusalChance', () => {
  it('is the base with no modifiers', () => {
    expect(refusalChance(NONE)).toBeCloseTo(c.base, 6)
  })

  it('rises with Federation rep, Charisma, the medical letter, and a bribe', () => {
    const repOnly = refusalChance({ ...NONE, federationRep: 60 })
    expect(repOnly).toBeCloseTo(c.base + 60 * c.federationRepWeight, 6)

    const withLetter = refusalChance({ ...NONE, medicalLetter: true })
    expect(withLetter).toBeCloseTo(c.base + c.medicalLetterBonus, 6)

    const withBribe = refusalChance({ ...NONE, bribe: true })
    expect(withBribe).toBeCloseTo(c.base + c.bribeBonus, 6)

    const stacked = refusalChance({
      ...NONE, federationRep: 60, charisma: 70, medicalLetter: true,
    })
    expect(stacked).toBeGreaterThan(repOnly)
    expect(stacked).toBeGreaterThan(withLetter)
  })

  it('drives the roll toward acceptance for a pro-pilot ambition', () => {
    // A high-rep, high-charisma player who WANTS in (mw_pilot/zeon_volunteer)
    // should refuse far less often than the same player without the ambition.
    const wantsOut = refusalChance({ ...NONE, federationRep: 60, charisma: 70 })
    const wantsIn = refusalChance({
      ...NONE, federationRep: 60, charisma: 70, proPilotAmbition: true,
    })
    expect(wantsIn).toBeLessThan(wantsOut)
    expect(c.proPilotAmbitionBias).toBeLessThan(0)
  })

  it('clamps to the configured floor and ceiling', () => {
    const floored = refusalChance({ ...NONE, proPilotAmbition: true })
    expect(floored).toBe(c.floor)

    const ceiled = refusalChance({
      ...NONE, federationRep: 100, charisma: 100, medicalLetter: true, bribe: true,
    })
    expect(ceiled).toBe(c.ceil)
  })
})
