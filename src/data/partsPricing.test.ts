import { describe, it, expect } from 'vitest'
import { fleetConfig } from '../config'
import { getMsWeapon } from './ms-weapons'
import { getMsFrameMod } from './ms-frame-mods'
import { msWeaponPrice, msFrameModPrice, partPrice } from './partsPricing'

describe('partsPricing', () => {
  it('derives weapon price linearly from damage', () => {
    const { weaponBasePrice, weaponPricePerDamage } = fleetConfig.partsPricing
    const def = getMsWeapon('ms-beamRifle')
    expect(msWeaponPrice('ms-beamRifle')).toBe(
      Math.round(weaponBasePrice + weaponPricePerDamage * def.damage),
    )
  })

  it('derives frame-mod price linearly from slotCount', () => {
    const { frameModBasePrice, frameModPricePerSlot } = fleetConfig.partsPricing
    const def = getMsFrameMod('armorPlating')
    expect(msFrameModPrice('armorPlating')).toBe(
      Math.round(frameModBasePrice + frameModPricePerSlot * def.slotCount),
    )
  })

  it('charges more for a higher-damage weapon', () => {
    // ms-ballisticGun (65 dmg) > ms-beamRifle (40 dmg)
    expect(msWeaponPrice('ms-ballisticGun')).toBeGreaterThan(msWeaponPrice('ms-beamRifle'))
  })

  it('charges more for a 2-slot mod than a 1-slot mod', () => {
    // armorPlating (2 slots) > autoloader (1 slot)
    expect(msFrameModPrice('armorPlating')).toBeGreaterThan(msFrameModPrice('autoloader'))
  })

  it('partPrice dispatches on kind', () => {
    expect(partPrice('weapon', 'ms-beamRifle')).toBe(msWeaponPrice('ms-beamRifle'))
    expect(partPrice('frameMod', 'autoloader')).toBe(msFrameModPrice('autoloader'))
  })

  it('throws on unknown part ids', () => {
    expect(() => msWeaponPrice('nope')).toThrow()
    expect(() => msFrameModPrice('nope')).toThrow()
  })
})
