import json5 from 'json5'
import raw from './ms.json5?raw'
import { isWeaponId, getWeapon } from './weapons'

// MS class blueprints (Phase 6.1 — single placeholder gm_pre). See
// ms.json5 for the schema. Per-instance retrofit (mountedWeapons,
// frameMods) and per-MS sortie resources land at 6.2.5; for now the
// frame's weapons and stats fully describe a runtime MS.

export type MountSize = 'small' | 'medium' | 'large'

export interface MsWeaponDef {
  weaponId: string
  size: MountSize
  firingArcDeg: number
  facingDeg: number
}

export interface MsClassDef {
  id: string
  nameZh: string
  descZh: string
  hullMax: number
  armorMax: number
  topSpeed: number
  accel: number
  decel: number
  angularAccel: number
  maxAngVel: number
  weapons: MsWeaponDef[]
  ai: {
    aggression: number
    retreatThresholdPct: number
    maintainRange: number
  }
}

interface MsFile {
  ms: MsClassDef[]
}

const parsed = json5.parse(raw) as MsFile

if (!Array.isArray(parsed.ms) || parsed.ms.length === 0) {
  throw new Error('ms.json5 must declare at least one MS class')
}

const VALID_MOUNT_SIZES: ReadonlySet<MountSize> = new Set<MountSize>([
  'small', 'medium', 'large',
])

const SIZE_RANK: Record<MountSize, number> = { small: 1, medium: 2, large: 3 }

const seen = new Set<string>()
for (const m of parsed.ms) {
  if (!m.id) throw new Error('ms.json5: ms missing id')
  if (seen.has(m.id)) throw new Error(`ms.json5: duplicate ms id "${m.id}"`)
  seen.add(m.id)
  if (m.hullMax <= 0) throw new Error(`ms.json5: ms "${m.id}" hullMax must be > 0`)
  if (m.armorMax < 0) throw new Error(`ms.json5: ms "${m.id}" armorMax must be >= 0`)
  if (m.topSpeed < 0) throw new Error(`ms.json5: ms "${m.id}" topSpeed must be >= 0`)
  if (m.accel < 0) throw new Error(`ms.json5: ms "${m.id}" accel must be >= 0`)
  if (m.decel < 0) throw new Error(`ms.json5: ms "${m.id}" decel must be >= 0`)
  if (m.angularAccel <= 0) throw new Error(`ms.json5: ms "${m.id}" angularAccel must be > 0`)
  if (m.maxAngVel <= 0) throw new Error(`ms.json5: ms "${m.id}" maxAngVel must be > 0`)
  if (!m.ai) throw new Error(`ms.json5: ms "${m.id}" missing ai block`)
  if (m.ai.aggression < 0 || m.ai.aggression > 1) {
    throw new Error(`ms.json5: ms "${m.id}" ai.aggression must be in [0,1]`)
  }
  if (m.ai.retreatThresholdPct < 0 || m.ai.retreatThresholdPct > 1) {
    throw new Error(`ms.json5: ms "${m.id}" ai.retreatThresholdPct must be in [0,1]`)
  }
  if (m.ai.maintainRange <= 0) {
    throw new Error(`ms.json5: ms "${m.id}" ai.maintainRange must be > 0`)
  }
  if (!Array.isArray(m.weapons) || m.weapons.length === 0) {
    throw new Error(`ms.json5: ms "${m.id}" must have at least one weapon`)
  }
  for (const w of m.weapons) {
    if (!isWeaponId(w.weaponId)) {
      throw new Error(`ms.json5: ms "${m.id}" unknown weapon "${w.weaponId}"`)
    }
    if (!VALID_MOUNT_SIZES.has(w.size)) {
      throw new Error(`ms.json5: ms "${m.id}" weapon "${w.weaponId}" invalid size "${w.size}"`)
    }
    const def = getWeapon(w.weaponId)
    if (SIZE_RANK[def.size] > SIZE_RANK[w.size]) {
      throw new Error(
        `ms.json5: ms "${m.id}" weapon "${w.weaponId}" (size ${def.size}) too large for declared mount size ${w.size}`,
      )
    }
    if (typeof w.firingArcDeg !== 'number' || w.firingArcDeg <= 0 || w.firingArcDeg > 360) {
      throw new Error(`ms.json5: ms "${m.id}" weapon "${w.weaponId}" firingArcDeg must be in (0, 360]`)
    }
    if (typeof w.facingDeg !== 'number') {
      throw new Error(`ms.json5: ms "${m.id}" weapon "${w.weaponId}" facingDeg must be a number`)
    }
  }
}

const byId: Record<string, MsClassDef> = Object.fromEntries(
  parsed.ms.map((m) => [m.id, m]),
)

export const MS_CLASSES: Record<string, MsClassDef> = byId

export const MS_CLASS_LIST: readonly MsClassDef[] = parsed.ms

export function getMsClass(id: string): MsClassDef {
  const def = byId[id]
  if (!def) throw new Error(`Unknown MS class id: ${id}`)
  return def
}

export function isMsClassId(id: string): boolean {
  return id in byId
}
