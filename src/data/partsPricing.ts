// Issue #64 — MS-parts price derivation for the AE parts broker.
//
// Pure functions: catalog unit price is derived linearly from the part's
// own stats so a hotter weapon / bulkier frame mod costs more, with all
// constants sourced from fleet.json5 partsPricing (no price literal in TS).
//   weapon  unit price = weaponBasePrice    + weaponPricePerDamage × damage
//   frameMod unit price = frameModBasePrice  + frameModPricePerSlot  × slotCount

import { fleetConfig } from '../config'
import { getMsWeapon } from './ms-weapons'
import { getMsFrameMod } from './ms-frame-mods'

export type PartKind = 'weapon' | 'frameMod'

export function msWeaponPrice(weaponId: string): number {
  const def = getMsWeapon(weaponId)
  const { weaponBasePrice, weaponPricePerDamage } = fleetConfig.partsPricing
  return Math.round(weaponBasePrice + weaponPricePerDamage * def.damage)
}

export function msFrameModPrice(modId: string): number {
  const def = getMsFrameMod(modId)
  const { frameModBasePrice, frameModPricePerSlot } = fleetConfig.partsPricing
  return Math.round(frameModBasePrice + frameModPricePerSlot * def.slotCount)
}

export function partPrice(kind: PartKind, partId: string): number {
  return kind === 'weapon' ? msWeaponPrice(partId) : msFrameModPrice(partId)
}
