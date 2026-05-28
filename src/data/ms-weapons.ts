import json5 from 'json5'
import raw from './ms-weapons.json5?raw'

export type MsHardpointType = 'small-arms' | 'medium-beam' | 'missile-rack'

export interface MsWeaponClassDef {
  id: string
  nameZh: string
  descZh: string
  mountType: MsHardpointType
  damage: number
  range: number
  chargeSec: number
  tier: number
  // Phase 6.2.5.C — per-sortie shot count cap. Energy weapons declare
  // `Infinity` and are exempt from the ammo-depletion gate; ballistic /
  // missile weapons declare a finite int and disable once depleted
  // until resupply at dock restores them.
  ammoCapacity: number
}

interface MsWeaponsFile {
  msWeapons: MsWeaponClassDef[]
}

const parsed = json5.parse(raw) as MsWeaponsFile

if (!Array.isArray(parsed.msWeapons) || parsed.msWeapons.length === 0) {
  throw new Error('ms-weapons.json5 must declare at least one weapon')
}

const VALID_MOUNT_TYPES: ReadonlySet<MsHardpointType> = new Set<MsHardpointType>([
  'small-arms', 'medium-beam', 'missile-rack',
])

const seen = new Set<string>()
for (const w of parsed.msWeapons) {
  if (!w.id) throw new Error('ms-weapons.json5: weapon missing id')
  if (seen.has(w.id)) throw new Error(`ms-weapons.json5: duplicate weapon id "${w.id}"`)
  seen.add(w.id)
  if (!VALID_MOUNT_TYPES.has(w.mountType)) {
    throw new Error(`ms-weapons.json5: weapon "${w.id}" invalid mountType "${w.mountType}"`)
  }
  if (w.damage <= 0) throw new Error(`ms-weapons.json5: weapon "${w.id}" damage must be > 0`)
  if (w.range <= 0) throw new Error(`ms-weapons.json5: weapon "${w.id}" range must be > 0`)
  if (w.chargeSec <= 0) throw new Error(`ms-weapons.json5: weapon "${w.id}" chargeSec must be > 0`)
  // Phase 6.2.5.C — ammoCapacity is either a positive integer (finite
  // magazines) or Infinity (energy weapons). Reject zero, negatives,
  // and NaN; permit Infinity through the integer-check sieve.
  if (typeof w.ammoCapacity !== 'number' || w.ammoCapacity <= 0 || Number.isNaN(w.ammoCapacity)) {
    throw new Error(`ms-weapons.json5: weapon "${w.id}" ammoCapacity must be > 0 or Infinity`)
  }
  if (Number.isFinite(w.ammoCapacity) && !Number.isInteger(w.ammoCapacity)) {
    throw new Error(`ms-weapons.json5: weapon "${w.id}" ammoCapacity must be an integer or Infinity`)
  }
}

const byId: Record<string, MsWeaponClassDef> = Object.fromEntries(
  parsed.msWeapons.map((w) => [w.id, w]),
)

export const MS_WEAPONS: Record<string, MsWeaponClassDef> = byId
export const MS_WEAPON_LIST: readonly MsWeaponClassDef[] = parsed.msWeapons

export function getMsWeapon(id: string): MsWeaponClassDef {
  const def = byId[id]
  if (!def) throw new Error(`Unknown MS weapon id: ${id}`)
  return def
}

export function isMsWeaponId(id: string): boolean {
  return id in byId
}

export function getMsWeaponsForType(mountType: MsHardpointType): MsWeaponClassDef[] {
  return parsed.msWeapons.filter((w) => w.mountType === mountType)
}
