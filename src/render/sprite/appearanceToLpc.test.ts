import { describe, expect, it } from 'vitest'
import type { AppearanceData } from '../../character/appearanceGen'
import { appearanceToLpc } from './appearanceToLpc'

function appearance(overrides: Partial<AppearanceData> = {}): AppearanceData {
  return {
    gender: 'female',
    physicalAge: 25,
    skin: 'light',
    hStyle: 'short',
    hLength: 20,
    hColor: 'black',
    pubicHStyle: 'neat',
    pubicHColor: 'black',
    underArmHStyle: 'shaved',
    underArmHColor: 'black',
    eyeIris: 'brown',
    weight: 0,
    muscles: 0,
    height: 165,
    hips: 1,
    butt: 2,
    waist: 0,
    boobs: 1000,
    lips: 25,
    makeup: 1,
    ...overrides,
  }
}

describe('appearanceToLpc — bodyType', () => {
  it('returns female regardless of muscles', () => {
    expect(appearanceToLpc(appearance({ gender: 'female', muscles: 100 })).bodyType).toBe('female')
  })

  it('returns male for males at or below the +30 muscular threshold', () => {
    expect(appearanceToLpc(appearance({ gender: 'male', muscles: 30 })).bodyType).toBe('male')
    expect(appearanceToLpc(appearance({ gender: 'male', muscles: 0 })).bodyType).toBe('male')
  })

  it('returns muscular for males above the +30 cutoff', () => {
    expect(appearanceToLpc(appearance({ gender: 'male', muscles: 31 })).bodyType).toBe('muscular')
  })
})

describe('appearanceToLpc — body palette', () => {
  it('maps fc skin tones to the LPC body palette', () => {
    const cases: Array<[string, string]> = [
      ['pale', 'light'],
      ['fair', 'light'],
      ['light', 'light'],
      ['tanned', 'amber'],
      ['olive', 'olive'],
      ['dark', 'brown'],
    ]
    for (const [fc, lpc] of cases) {
      const m = appearanceToLpc(appearance({ skin: fc }))
      const body = m.layers.find((l) => l.material === 'body' && l.zPos === 10)!
      expect(body.color).toBe(lpc)
    }
  })

  it('falls back to light for unknown skin tones', () => {
    const m = appearanceToLpc(appearance({ skin: 'martian-green' }))
    const body = m.layers.find((l) => l.material === 'body' && l.zPos === 10)!
    expect(body.color).toBe('light')
  })
})

describe('appearanceToLpc — base layers', () => {
  it('emits a body layer at zPos 10 and a head layer at zPos 100', () => {
    const m = appearanceToLpc(appearance({ gender: 'female', skin: 'fair' }))
    const body = m.layers.find((l) => l.zPos === 10)
    const head = m.layers.find((l) => l.zPos === 100)
    expect(body?.material).toBe('body')
    expect(body?.basePath).toBe('body/bodies/female')
    expect(head?.material).toBe('body')
    expect(head?.basePath).toBe('head/heads/human/female')
  })

  it('uses the matching male head folder for males', () => {
    const m = appearanceToLpc(appearance({ gender: 'male' }))
    const head = m.layers.find((l) => l.zPos === 100)!
    expect(head.basePath).toBe('head/heads/human/male')
  })

  it('keeps body and head color tonally aligned', () => {
    const m = appearanceToLpc(appearance({ skin: 'tanned' }))
    const body = m.layers.find((l) => l.zPos === 10)!
    const head = m.layers.find((l) => l.zPos === 100)!
    expect(head.color).toBe(body.color)
  })
})

describe('appearanceToLpc — hair palette', () => {
  it('maps fc hair colors to the LPC hair palette', () => {
    const cases: Array<[string, string]> = [
      ['black', 'black'],
      ['dark brown', 'dark_brown'],
      ['brown', 'light_brown'],
      ['chestnut', 'chestnut'],
      ['auburn', 'redhead'],
      ['red', 'red'],
      ['blonde', 'blonde'],
      ['platinum blonde', 'platinum'],
    ]
    for (const [fc, lpc] of cases) {
      const m = appearanceToLpc(appearance({ hColor: fc, hStyle: 'short' }))
      const hair = m.layers.find((l) => l.material === 'hair')
      expect(hair?.color).toBe(lpc)
    }
  })

  it('falls back to light_brown for unknown hair colors', () => {
    const m = appearanceToLpc(appearance({ hColor: 'rainbow', hStyle: 'short' }))
    const hair = m.layers.find((l) => l.material === 'hair')!
    expect(hair.color).toBe('light_brown')
  })
})

describe('appearanceToLpc — hair geometry', () => {
  it('skips hair entirely for shaved males', () => {
    const m = appearanceToLpc(appearance({ gender: 'male', hStyle: 'shaved' }))
    const hair = m.layers.find((l) => l.material === 'hair')
    expect(hair).toBeUndefined()
  })

  it('emits one flat hair layer at zPos 120 for short male styles', () => {
    const m = appearanceToLpc(appearance({ gender: 'male', hStyle: 'crew cut' }))
    const hair = m.layers.filter((l) => l.material === 'hair')
    expect(hair).toHaveLength(1)
    expect(hair[0].basePath).toBe('hair/buzzcut/adult')
    expect(hair[0].zPos).toBe(120)
  })

  it('emits one flat layer for short female pixie/short/shoulder-length/messy bun', () => {
    for (const hStyle of ['pixie', 'short', 'shoulder-length', 'messy bun']) {
      const m = appearanceToLpc(appearance({ gender: 'female', hStyle, hLength: 30 }))
      const hair = m.layers.filter((l) => l.material === 'hair')
      expect(hair, `style=${hStyle}`).toHaveLength(1)
      expect(hair[0].zPos).toBe(120)
    }
  })

  it('splits long neat female hair (>=40) into fg+bg drape', () => {
    const m = appearanceToLpc(appearance({ gender: 'female', hStyle: 'neat', hLength: 60 }))
    const hair = m.layers.filter((l) => l.material === 'hair')
    expect(hair).toHaveLength(2)
    const fg = hair.find((l) => l.zPos === 120)!
    const bg = hair.find((l) => l.zPos === 9)!
    expect(fg.basePath).toBe('hair/long_center_part/adult/fg')
    expect(bg.basePath).toBe('hair/long_center_part/adult/bg')
  })

  it('keeps short neat female hair (<40) flat', () => {
    const m = appearanceToLpc(appearance({ gender: 'female', hStyle: 'neat', hLength: 30 }))
    const hair = m.layers.filter((l) => l.material === 'hair')
    expect(hair).toHaveLength(1)
    expect(hair[0].basePath).toBe('hair/parted/adult')
  })

  it('always splits female braided', () => {
    const m = appearanceToLpc(appearance({ gender: 'female', hStyle: 'braided', hLength: 80 }))
    const hair = m.layers.filter((l) => l.material === 'hair')
    expect(hair).toHaveLength(2)
    expect(hair.find((l) => l.zPos === 120)?.basePath).toBe('hair/braid/adult/fg')
    expect(hair.find((l) => l.zPos === 9)?.basePath).toBe('hair/braid/adult/bg')
  })

  it('uses pigtails (flat) for long female tails (>=40)', () => {
    const m = appearanceToLpc(appearance({ gender: 'female', hStyle: 'tails', hLength: 60 }))
    const hair = m.layers.filter((l) => l.material === 'hair')
    expect(hair).toHaveLength(1)
    expect(hair[0].basePath).toBe('hair/pigtails/adult')
  })

  it('splits female tails (<40) into bunches', () => {
    const m = appearanceToLpc(appearance({ gender: 'female', hStyle: 'tails', hLength: 30 }))
    const hair = m.layers.filter((l) => l.material === 'hair')
    expect(hair).toHaveLength(2)
    expect(hair.find((l) => l.zPos === 120)?.basePath).toBe('hair/bunches/adult/fg')
    expect(hair.find((l) => l.zPos === 9)?.basePath).toBe('hair/bunches/adult/bg')
  })
})
