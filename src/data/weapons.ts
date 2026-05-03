import json5 from 'json5'
import raw from './weapons.json5?raw'

export type WeaponType = 'beam' | 'ballistic' | 'missile' | 'mega'
export type MountSize = 'small' | 'medium' | 'large'

export interface WeaponDef {
  id: string
  nameZh: string
  descZh: string
  type: WeaponType
  size: MountSize
  damage: number
  range: number
  chargeSec: number
  fluxPerShot: number
  shieldDamage: number
  armorDamage: number
  projectileSpeed: number
  tracking: number
  tier: 1 | 2 | 3
  cost: number
}

interface WeaponsFile {
  weapons: WeaponDef[]
}

const parsed = json5.parse(raw) as WeaponsFile

if (!Array.isArray(parsed.weapons) || parsed.weapons.length === 0) {
  throw new Error('weapons.json5 must declare at least one weapon')
}

const VALID_TYPES: ReadonlySet<WeaponType> = new Set<WeaponType>([
  'beam', 'ballistic', 'missile', 'mega',
])
const VALID_SIZES: ReadonlySet<MountSize> = new Set<MountSize>([
  'small', 'medium', 'large',
])

const seen = new Set<string>()
for (const w of parsed.weapons) {
  if (!w.id) throw new Error('weapons.json5: weapon missing id')
  if (seen.has(w.id)) throw new Error(`weapons.json5: duplicate weapon id "${w.id}"`)
  seen.add(w.id)
  if (!VALID_TYPES.has(w.type)) {
    throw new Error(`weapons.json5: weapon "${w.id}" invalid type "${w.type}"`)
  }
  if (!VALID_SIZES.has(w.size)) {
    throw new Error(`weapons.json5: weapon "${w.id}" invalid size "${w.size}"`)
  }
  if (w.damage < 0) {
    throw new Error(`weapons.json5: weapon "${w.id}" damage must be >= 0`)
  }
  if (w.range <= 0) {
    throw new Error(`weapons.json5: weapon "${w.id}" range must be > 0`)
  }
  if (w.chargeSec <= 0) {
    throw new Error(`weapons.json5: weapon "${w.id}" chargeSec must be > 0`)
  }
  if (w.fluxPerShot < 0) {
    throw new Error(`weapons.json5: weapon "${w.id}" fluxPerShot must be >= 0`)
  }
  if (w.tracking < 0 || w.tracking > 1) {
    throw new Error(`weapons.json5: weapon "${w.id}" tracking must be in [0, 1]`)
  }
  if (w.tier !== 1 && w.tier !== 2 && w.tier !== 3) {
    throw new Error(`weapons.json5: weapon "${w.id}" tier must be 1|2|3`)
  }
}

const byId: Record<string, WeaponDef> = Object.fromEntries(
  parsed.weapons.map((w) => [w.id, w]),
)

export const WEAPONS: Record<string, WeaponDef> = byId

export const WEAPON_LIST: readonly WeaponDef[] = parsed.weapons

export function getWeapon(id: string): WeaponDef {
  const def = byId[id]
  if (!def) throw new Error(`Unknown weapon id: ${id}`)
  return def
}

export function isWeaponId(id: string): boolean {
  return id in byId
}
