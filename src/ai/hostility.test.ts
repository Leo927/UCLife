import { describe, it, expect } from 'vitest'
import { isHostile } from './hostility'

const ENMITY: Record<string, string[]> = {
  zeon: ['federation'],
  federation: ['zeon'],
}

describe('isHostile', () => {
  it('is hostile when the player faction is in the guard faction enmity row', () => {
    expect(isHostile('zeon', 'federation', ENMITY)).toBe(true)
    expect(isHostile('federation', 'zeon', ENMITY)).toBe(true)
  })

  it('is not hostile to a neutral (unaligned) player', () => {
    expect(isHostile('zeon', null, ENMITY)).toBe(false)
    expect(isHostile('federation', null, ENMITY)).toBe(false)
  })

  it('is not hostile to the guard own faction', () => {
    expect(isHostile('zeon', 'zeon', ENMITY)).toBe(false)
  })

  it('is not hostile to a faction with no enmity edge', () => {
    expect(isHostile('zeon', 'anaheim', ENMITY)).toBe(false)
    expect(isHostile('anaheim', 'zeon', ENMITY)).toBe(false)
  })
})
