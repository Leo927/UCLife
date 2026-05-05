import { describe, expect, it } from 'vitest'
import {
  generateAppearance,
  generateAppearanceForName,
  hashSeed,
} from './appearanceGen'

describe('hashSeed', () => {
  it('matches the FNV-1a 32-bit offset basis on empty input', () => {
    // FNV-1a 32-bit specifies offset_basis = 0x811c9dc5; with no bytes mixed
    // in the hash equals the basis itself.
    expect(hashSeed('')).toBe(0x811c9dc5)
  })

  it('matches FNV-1a 32-bit known vectors', () => {
    // Reference vectors from the FNV-1a 32-bit spec.
    expect(hashSeed('a')).toBe(0xe40c292c)
    expect(hashSeed('foobar')).toBe(0xbf9cf968)
  })

  it('is deterministic across calls', () => {
    expect(hashSeed('Amuro Ray')).toBe(hashSeed('Amuro Ray'))
  })

  it('returns an unsigned 32-bit integer', () => {
    for (const s of ['', 'a', 'longer-name-string', '夏亚']) {
      const h = hashSeed(s)
      expect(Number.isInteger(h)).toBe(true)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(0xffffffff)
    }
  })

  it('distinguishes single-character differences', () => {
    expect(hashSeed('Char')).not.toBe(hashSeed('Chad'))
  })
})

describe('generateAppearance', () => {
  it('is reproducible for the same seed', () => {
    const a = generateAppearance(0xdeadbeef)
    const b = generateAppearance(0xdeadbeef)
    expect(a).toEqual(b)
  })

  it('honors an explicit gender override', () => {
    expect(generateAppearance(1, { gender: 'male' }).gender).toBe('male')
    expect(generateAppearance(1, { gender: 'female' }).gender).toBe('female')
  })

  it('forces boobs=0 for males and >=800 for females', () => {
    const m = generateAppearance(42, { gender: 'male' })
    expect(m.boobs).toBe(0)
    const f = generateAppearance(42, { gender: 'female' })
    expect(f.boobs).toBeGreaterThanOrEqual(800)
    expect(f.boobs).toBeLessThanOrEqual(2000)
  })

  it('emits gender-specific height ranges', () => {
    for (let s = 0; s < 32; s++) {
      const m = generateAppearance(s, { gender: 'male' })
      expect(m.height).toBeGreaterThanOrEqual(165)
      expect(m.height).toBeLessThanOrEqual(188)
      const f = generateAppearance(s, { gender: 'female' })
      expect(f.height).toBeGreaterThanOrEqual(152)
      expect(f.height).toBeLessThanOrEqual(175)
    }
  })

  it('forces makeup=0 for males', () => {
    for (let s = 0; s < 32; s++) {
      expect(generateAppearance(s, { gender: 'male' }).makeup).toBe(0)
    }
  })

  it('shares hColor across head, pubic, and underarm by default', () => {
    const a = generateAppearance(99)
    expect(a.pubicHColor).toBe(a.hColor)
    expect(a.underArmHColor).toBe(a.hColor)
  })

  it('produces every documented field', () => {
    const a = generateAppearance(7)
    const expected: Array<keyof typeof a> = [
      'gender', 'physicalAge', 'skin', 'hStyle', 'hLength', 'hColor',
      'pubicHStyle', 'pubicHColor', 'underArmHStyle', 'underArmHColor',
      'eyeIris', 'weight', 'muscles', 'height', 'hips', 'butt', 'waist',
      'boobs', 'lips', 'makeup',
    ]
    for (const k of expected) expect(a).toHaveProperty(k)
  })
})

describe('generateAppearanceForName', () => {
  it('equals generateAppearance(hashSeed(name))', () => {
    const name = 'Bright Noa'
    expect(generateAppearanceForName(name))
      .toEqual(generateAppearance(hashSeed(name)))
  })

  it('honors gender overrides through the wrapper', () => {
    const f = generateAppearanceForName('Sayla Mass', { gender: 'female' })
    const m = generateAppearanceForName('Sayla Mass', { gender: 'male' })
    expect(f.gender).toBe('female')
    expect(m.gender).toBe('male')
  })
})
