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

// W3 (ms-identity) Task 3 — vernier boost. Authored per-frame; ships
// (ship-classes.json5 / non-isMs enemyShips.json5 rows) have no boost block
// at all — locked decision, "ships get no boost."
export interface MsBoostDef {
  // Multiplier on topSpeed + accel while boostRemainingSec > 0. Must be > 1
  // (a boost that doesn't speed anything up isn't a boost).
  speedMul: number
  // How long the speed multiplier stays active, in tactical seconds.
  durationSec: number
  // Extra downtime AFTER the active window before tryBoost() can fire
  // again — combatSystem gates re-trigger on durationSec + cooldownSec
  // combined (see CombatShipState.boostCooldownSec).
  cooldownSec: number
  // Propellant cost debited immediately on activation. Only the player's
  // own piloted MS has a propellant ledger today (the Ms trait's
  // currentPropellant) — enemy/wing MS boost is free of this ledger; see
  // systems/combat.ts's tryBoost.
  propellantCost: number
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
  // Issue #69 — tactical deployment-points cost. Optional so legacy MS
  // authoring stays loadable (folds to 0); new classes author explicitly.
  dpCost?: number
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
  // W3 (ms-identity) Task 3 — projectile/beam collision radius (arena
  // units). Small relative to combatConfig.defaultShipHitRadiusPx so an MS
  // is genuinely harder to hit than a ship hull.
  hitRadiusPx: number
  boost: MsBoostDef
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
  if (m.dpCost !== undefined && (typeof m.dpCost !== 'number' || m.dpCost < 0)) {
    throw new Error(`ms-classes.json5: ms "${m.id}" dpCost must be a non-negative number`)
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
  if (typeof m.hitRadiusPx !== 'number' || m.hitRadiusPx <= 0) {
    throw new Error(`ms-classes.json5: ms "${m.id}" hitRadiusPx must be > 0`)
  }
  if (!m.boost || typeof m.boost !== 'object') {
    throw new Error(`ms-classes.json5: ms "${m.id}" missing boost block`)
  }
  if (typeof m.boost.speedMul !== 'number' || m.boost.speedMul <= 1) {
    throw new Error(`ms-classes.json5: ms "${m.id}" boost.speedMul must be a number > 1`)
  }
  if (typeof m.boost.durationSec !== 'number' || m.boost.durationSec <= 0) {
    throw new Error(`ms-classes.json5: ms "${m.id}" boost.durationSec must be a number > 0`)
  }
  if (typeof m.boost.cooldownSec !== 'number' || m.boost.cooldownSec < 0) {
    throw new Error(`ms-classes.json5: ms "${m.id}" boost.cooldownSec must be a number >= 0`)
  }
  if (typeof m.boost.propellantCost !== 'number' || m.boost.propellantCost < 0) {
    throw new Error(`ms-classes.json5: ms "${m.id}" boost.propellantCost must be a number >= 0`)
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
