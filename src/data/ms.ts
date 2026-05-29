import json5 from 'json5'
import raw from './ms-classes.json5?raw'
import { isMsWeaponId, type MsHardpointType } from './ms-weapons'

// MS class blueprints — Phase 6.2.5.A. Source file renamed to
// ms-classes.json5; now carries hardpoints[] for per-instance retrofit.

export type MountSize = 'small' | 'medium' | 'large'

export interface MsHardpointDef {
  id: string
  type: MsHardpointType
  firingArcDeg: number
  facingDeg: number
  defaultWeaponId: string
}

export interface MsClassDef {
  id: string
  nameZh: string
  descZh: string
  // Phase 6.2.5.B — broker sticker price (¥). Read by the AE vehicle-sales
  // dialogue branch + the smoke that buys at the broker.
  priceFiat: number
  // Phase 6.2.5.B — daily supply consumption while the MS is in any
  // non-mothballed hangar. Folded into the fleet-supply drain at Issue #63.
  supplyPerDay: number
  // Issue #63 — additional daily supply consumption while this MS is
  // in-repair (damaged hull/armor being restored at a hangar).
  supplyPerRepairDay: number
  hullMax: number
  armorMax: number
  topSpeed: number
  accel: number
  decel: number
  angularAccel: number
  maxAngVel: number
  // Phase 6.2.5.C — sortie resource caps + frame mod budget. See header.
  propellantStorage: number
  lifeSupportMinutes: number
  frameSlots: number
  hardpoints: MsHardpointDef[]
  ai: {
    aggression: number
    retreatThresholdPct: number
    maintainRange: number
  }
}

interface MsClassFile {
  ms: MsClassDef[]
}

const parsed = json5.parse(raw) as MsClassFile

if (!Array.isArray(parsed.ms) || parsed.ms.length === 0) {
  throw new Error('ms-classes.json5 must declare at least one MS class')
}

const VALID_HP_TYPES: ReadonlySet<MsHardpointType> = new Set<MsHardpointType>([
  'small-arms', 'medium-beam', 'missile-rack',
])

const seen = new Set<string>()
for (const m of parsed.ms) {
  if (!m.id) throw new Error('ms-classes.json5: ms missing id')
  if (seen.has(m.id)) throw new Error(`ms-classes.json5: duplicate ms id "${m.id}"`)
  seen.add(m.id)
  if (m.hullMax <= 0) throw new Error(`ms-classes.json5: ms "${m.id}" hullMax must be > 0`)
  if (m.armorMax < 0) throw new Error(`ms-classes.json5: ms "${m.id}" armorMax must be >= 0`)
  if (m.topSpeed < 0) throw new Error(`ms-classes.json5: ms "${m.id}" topSpeed must be >= 0`)
  if (m.accel < 0) throw new Error(`ms-classes.json5: ms "${m.id}" accel must be >= 0`)
  if (m.decel < 0) throw new Error(`ms-classes.json5: ms "${m.id}" decel must be >= 0`)
  if (m.angularAccel <= 0) throw new Error(`ms-classes.json5: ms "${m.id}" angularAccel must be > 0`)
  if (m.maxAngVel <= 0) throw new Error(`ms-classes.json5: ms "${m.id}" maxAngVel must be > 0`)
  if (typeof m.priceFiat !== 'number' || m.priceFiat < 0) {
    throw new Error(`ms-classes.json5: ms "${m.id}" priceFiat must be >= 0`)
  }
  if (typeof m.supplyPerDay !== 'number' || m.supplyPerDay < 0) {
    throw new Error(`ms-classes.json5: ms "${m.id}" supplyPerDay must be >= 0`)
  }
  if (typeof m.supplyPerRepairDay !== 'number' || m.supplyPerRepairDay < 0) {
    throw new Error(`ms-classes.json5: ms "${m.id}" supplyPerRepairDay must be >= 0`)
  }
  if (typeof m.propellantStorage !== 'number' || m.propellantStorage <= 0) {
    throw new Error(`ms-classes.json5: ms "${m.id}" propellantStorage must be > 0`)
  }
  if (typeof m.lifeSupportMinutes !== 'number' || m.lifeSupportMinutes <= 0) {
    throw new Error(`ms-classes.json5: ms "${m.id}" lifeSupportMinutes must be > 0`)
  }
  if (!Number.isInteger(m.frameSlots) || m.frameSlots < 0) {
    throw new Error(`ms-classes.json5: ms "${m.id}" frameSlots must be a non-negative integer`)
  }
  if (!m.ai) throw new Error(`ms-classes.json5: ms "${m.id}" missing ai block`)
  if (m.ai.aggression < 0 || m.ai.aggression > 1) {
    throw new Error(`ms-classes.json5: ms "${m.id}" ai.aggression must be in [0,1]`)
  }
  if (m.ai.retreatThresholdPct < 0 || m.ai.retreatThresholdPct > 1) {
    throw new Error(`ms-classes.json5: ms "${m.id}" ai.retreatThresholdPct must be in [0,1]`)
  }
  if (m.ai.maintainRange <= 0) {
    throw new Error(`ms-classes.json5: ms "${m.id}" ai.maintainRange must be > 0`)
  }
  if (!Array.isArray(m.hardpoints) || m.hardpoints.length === 0) {
    throw new Error(`ms-classes.json5: ms "${m.id}" must have at least one hardpoint`)
  }
  const hpSeen = new Set<string>()
  for (const hp of m.hardpoints) {
    if (!hp.id) throw new Error(`ms-classes.json5: ms "${m.id}" hardpoint missing id`)
    if (hpSeen.has(hp.id)) throw new Error(`ms-classes.json5: ms "${m.id}" duplicate hardpoint id "${hp.id}"`)
    hpSeen.add(hp.id)
    if (!VALID_HP_TYPES.has(hp.type)) {
      throw new Error(`ms-classes.json5: ms "${m.id}" hardpoint "${hp.id}" invalid type "${hp.type}"`)
    }
    if (typeof hp.firingArcDeg !== 'number' || hp.firingArcDeg <= 0 || hp.firingArcDeg > 360) {
      throw new Error(`ms-classes.json5: ms "${m.id}" hardpoint "${hp.id}" firingArcDeg must be in (0, 360]`)
    }
    if (typeof hp.facingDeg !== 'number') {
      throw new Error(`ms-classes.json5: ms "${m.id}" hardpoint "${hp.id}" facingDeg must be a number`)
    }
    if (!isMsWeaponId(hp.defaultWeaponId)) {
      throw new Error(`ms-classes.json5: ms "${m.id}" hardpoint "${hp.id}" unknown defaultWeaponId "${hp.defaultWeaponId}"`)
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

export function defaultMountedWeapons(cls: MsClassDef): Record<string, string> {
  const out: Record<string, string> = {}
  for (const hp of cls.hardpoints) {
    out[hp.id] = hp.defaultWeaponId
  }
  return out
}
