import { describe, it, expect } from 'vitest'
import { classShape } from './shipSilhouette'
import { combatConfig } from '../../config'

describe('classShape', () => {
  it('maps a known player hull to its authored silhouette family', () => {
    expect(classShape('lightFreighter').family).toBe('freighter')
    expect(classShape('pegasusClass').family).toBe('capital')
    expect(classShape('lunarMilitia').family).toBe('frigate')
  })

  it('maps mobile-suit class ids to the ms family', () => {
    expect(classShape('gm_pre').family).toBe('ms')
    expect(classShape('pirate_junkerMs').family).toBe('ms')
  })

  it('falls back to the configured default family for unmapped ids', () => {
    const fallback = combatConfig.shipSilhouettes.fallback
    expect(classShape('totally-unknown-hull-xyz').family).toBe(fallback)
    expect(classShape('').family).toBe(fallback)
  })

  it('returns a closed polygon: flat, even-length, at least a triangle', () => {
    const spec = classShape('lightFreighter')
    expect(Array.isArray(spec.points)).toBe(true)
    expect(spec.points.length % 2).toBe(0)
    expect(spec.points.length).toBeGreaterThanOrEqual(6)
    for (const n of spec.points) expect(Number.isFinite(n)).toBe(true)
  })

  it('is a pure lookup: same id yields an equal spec every call', () => {
    expect(classShape('pegasusClass')).toEqual(classShape('pegasusClass'))
  })
})
