import json5 from 'json5'
import raw from './weapons.json5?raw'

export type WeaponType = 'beam' | 'missile' | 'mega' | 'flak'

// `room` targets a single enemy room; future weapon types may support
// cluster / area effects. Keep narrow until a second mode actually ships.
export type WeaponTargeting = 'room'

// Coarse accuracy descriptor. Phase 6.0 keeps this as a hint string —
// the live combat system in Phase 6.1+ resolves it against operator
// Marksmanship and engine-driven evasion. `guided` shorthand corresponds
// to FTL missile behavior (pierces shields, very high hit rate).
export type WeaponAccuracy = 'low' | 'medium' | 'high' | 'guided'

export interface WeaponDef {
  id: string
  nameZh: string
  descZh: string
  type: WeaponType
  powerCost: number
  chargeSec: number
  damage: number
  systemDamage?: number
  pierceShields?: boolean
  shotCount: number
  targetable: WeaponTargeting
  accuracy: WeaponAccuracy
  cost: number
  tier: 1 | 2 | 3
}

interface WeaponsFile {
  weapons: WeaponDef[]
}

const parsed = json5.parse(raw) as WeaponsFile

if (!Array.isArray(parsed.weapons) || parsed.weapons.length === 0) {
  throw new Error('weapons.json5 must declare at least one weapon')
}

const VALID_TYPES: ReadonlySet<WeaponType> = new Set<WeaponType>([
  'beam',
  'missile',
  'mega',
  'flak',
])

const VALID_ACCURACY: ReadonlySet<WeaponAccuracy> = new Set<WeaponAccuracy>([
  'low',
  'medium',
  'high',
  'guided',
])

const seen = new Set<string>()
for (const w of parsed.weapons) {
  if (!w.id) throw new Error('weapons.json5: weapon missing id')
  if (seen.has(w.id)) throw new Error(`weapons.json5: duplicate weapon id "${w.id}"`)
  seen.add(w.id)
  if (!VALID_TYPES.has(w.type)) {
    throw new Error(`weapons.json5: weapon "${w.id}" has invalid type "${w.type}"`)
  }
  if (!VALID_ACCURACY.has(w.accuracy)) {
    throw new Error(`weapons.json5: weapon "${w.id}" has invalid accuracy "${w.accuracy}"`)
  }
  if (w.targetable !== 'room') {
    throw new Error(`weapons.json5: weapon "${w.id}" has unsupported targetable "${w.targetable}"`)
  }
  if (w.powerCost < 0) {
    throw new Error(`weapons.json5: weapon "${w.id}" powerCost must be >= 0`)
  }
  if (w.chargeSec <= 0) {
    throw new Error(`weapons.json5: weapon "${w.id}" chargeSec must be > 0`)
  }
  if (w.shotCount <= 0) {
    throw new Error(`weapons.json5: weapon "${w.id}" shotCount must be > 0`)
  }
  if (w.tier !== 1 && w.tier !== 2 && w.tier !== 3) {
    throw new Error(`weapons.json5: weapon "${w.id}" tier must be 1|2|3 (got ${w.tier})`)
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
