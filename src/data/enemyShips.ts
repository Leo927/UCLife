import json5 from 'json5'
import raw from './enemyShips.json5?raw'
import { isWeaponId, getWeapon } from './weapons'
import type { MountSize } from './weapons'
import { isMsWeaponId } from './ms-weapons'
import { isMsFrameModId } from './ms-frame-mods'
import { isShipClassId } from './ship-classes'
import type { MsBoostDef } from './ms'

// Issue #64 — per-enemy-class MS-parts salvage drop entry.
export type SalvageKind = 'weapon' | 'frameMod'
export interface SalvageEntry {
  partId: string
  kind: SalvageKind
  chance: number   // 0..1 drop probability, rolled with the seeded combat RNG
  qty: number      // units credited to PlayerPartsInventory when the roll passes
}

// Enemy ship blueprint — Starsector-shape stat block. Combat spawns a
// CombatShipState entity from one of these.

export interface EnemyMountDef {
  idx: number
  size: MountSize
  firingArcDeg: number    // total firing arc in degrees
  facingDeg: number       // mount center direction in degrees relative to ship
}

// W3 (ms-identity) — hostile-MS pilot quality block. Consumed by Task 4's
// enemy-MS AI (reaction delay on target switches, aim-solution jitter,
// probabilistic boost use); authored here so the data + validation land
// ahead of the AI that reads it.
export interface EnemyPilotQuality {
  reactionSec: number    // seconds of delay before the AI reacts to a new target
  aimJitterRad: number   // radians of random perturbation applied to fire solutions
  boostUse: number       // 0..1 probability the AI triggers boost when closing/disengaging
}

export interface EnemyShipBlueprint {
  id: string
  nameZh: string
  descZh: string
  hullMax: number
  armorMax: number
  fluxMax: number
  fluxDissipation: number
  hasShield: boolean
  shieldEfficiency: number
  topSpeed: number
  accel: number
  decel: number
  angularAccel: number
  maxAngVel: number
  mounts: EnemyMountDef[]
  defaultWeapons: string[]
  ai: {
    aggression: number
    retreatThresholdPct: number
    maintainRange: number
  }
  // W3 (ms-identity) — marks this row as a hostile mobile suit rather than
  // a ship. Spawns as a small/fast CombatShipState row (see systems/combat.ts
  // spawnEnemyMsComplement); requires the `pilot` block below.
  isMs?: boolean
  pilot?: EnemyPilotQuality
  // W3 (ms-identity) Task 3 — required iff isMs (mirrors the pilot block):
  // collision radius (arena units, small relative to combat.json5's
  // defaultShipHitRadiusPx) + vernier boost. Ships have neither field.
  hitRadiusPx?: number
  boost?: MsBoostDef
  // Issue #64 — optional MS-parts salvage table. Absent = no parts drop.
  salvage?: SalvageEntry[]
  // Issue #71 — recoverables. The ship-classes.json5 template id a Recover'd
  // hull joins the fleet as (pre-authored hostile-eligible class), and the
  // crew complement that sizes the prize-crew gate. Required on every class.
  recoverTemplateId: string
  crewRequired: number
}

interface EnemyShipsFile {
  ships: EnemyShipBlueprint[]
}

const parsed = json5.parse(raw) as EnemyShipsFile

if (!Array.isArray(parsed.ships) || parsed.ships.length === 0) {
  throw new Error('enemyShips.json5 must declare at least one ship')
}

const VALID_SIZES: ReadonlySet<MountSize> = new Set<MountSize>([
  'small', 'medium', 'large',
])
const SIZE_RANK: Record<MountSize, number> = { small: 1, medium: 2, large: 3 }

const seen = new Set<string>()
for (const ship of parsed.ships) {
  if (!ship.id) throw new Error('enemyShips.json5: ship missing id')
  if (seen.has(ship.id)) {
    throw new Error(`enemyShips.json5: duplicate ship id "${ship.id}"`)
  }
  seen.add(ship.id)

  if (ship.hullMax <= 0) throw new Error(`enemyShips.json5: ship "${ship.id}" hullMax must be > 0`)
  if (ship.armorMax < 0) throw new Error(`enemyShips.json5: ship "${ship.id}" armorMax must be >= 0`)
  if (ship.fluxMax < 0) throw new Error(`enemyShips.json5: ship "${ship.id}" fluxMax must be >= 0`)
  if (ship.fluxDissipation < 0) throw new Error(`enemyShips.json5: ship "${ship.id}" fluxDissipation must be >= 0`)
  if (typeof ship.hasShield !== 'boolean') {
    throw new Error(`enemyShips.json5: ship "${ship.id}" hasShield must be a boolean`)
  }
  if (ship.shieldEfficiency < 0) {
    throw new Error(`enemyShips.json5: ship "${ship.id}" shieldEfficiency must be >= 0`)
  }
  if (ship.topSpeed < 0) throw new Error(`enemyShips.json5: ship "${ship.id}" topSpeed must be >= 0`)
  if (typeof ship.accel !== 'number' || ship.accel < 0) {
    throw new Error(`enemyShips.json5: ship "${ship.id}" accel must be a number >= 0`)
  }
  if (typeof ship.decel !== 'number' || ship.decel < 0) {
    throw new Error(`enemyShips.json5: ship "${ship.id}" decel must be a number >= 0`)
  }
  if (typeof ship.angularAccel !== 'number' || ship.angularAccel <= 0) {
    throw new Error(`enemyShips.json5: ship "${ship.id}" angularAccel must be a number > 0`)
  }
  if (typeof ship.maxAngVel !== 'number' || ship.maxAngVel <= 0) {
    throw new Error(`enemyShips.json5: ship "${ship.id}" maxAngVel must be a number > 0`)
  }

  const mountIdxSeen = new Set<number>()
  for (const m of ship.mounts) {
    if (mountIdxSeen.has(m.idx)) {
      throw new Error(`enemyShips.json5: ship "${ship.id}" duplicate mount idx ${m.idx}`)
    }
    mountIdxSeen.add(m.idx)
    if (!VALID_SIZES.has(m.size)) {
      throw new Error(`enemyShips.json5: ship "${ship.id}" mount ${m.idx} invalid size`)
    }
    if (typeof m.firingArcDeg !== 'number' || m.firingArcDeg <= 0 || m.firingArcDeg > 360) {
      throw new Error(`enemyShips.json5: ship "${ship.id}" mount ${m.idx} firingArcDeg must be in (0, 360]`)
    }
    if (typeof m.facingDeg !== 'number') {
      throw new Error(`enemyShips.json5: ship "${ship.id}" mount ${m.idx} facingDeg must be a number`)
    }
  }

  if (ship.defaultWeapons.length !== ship.mounts.length) {
    throw new Error(
      `enemyShips.json5: ship "${ship.id}" has ${ship.defaultWeapons.length} weapons but ${ship.mounts.length} mounts — every declared mount must be armed (mirrors ship-classes' #165 rule)`,
    )
  }
  ship.defaultWeapons.forEach((wId, i) => {
    if (!isWeaponId(wId)) {
      throw new Error(`enemyShips.json5: ship "${ship.id}" weapon "${wId}" not in weapons.json5`)
    }
    const w = getWeapon(wId)
    const mountSize = ship.mounts[i].size
    if (SIZE_RANK[w.size] > SIZE_RANK[mountSize]) {
      throw new Error(
        `enemyShips.json5: ship "${ship.id}" weapon "${wId}" too large for mount ${i}`,
      )
    }
  })

  if (ship.ai.aggression < 0 || ship.ai.aggression > 1) {
    throw new Error(`enemyShips.json5: ship "${ship.id}" ai.aggression must be in [0,1]`)
  }
  if (ship.ai.retreatThresholdPct < 0 || ship.ai.retreatThresholdPct > 1) {
    throw new Error(`enemyShips.json5: ship "${ship.id}" ai.retreatThresholdPct must be in [0,1]`)
  }
  if (ship.ai.maintainRange <= 0) {
    throw new Error(`enemyShips.json5: ship "${ship.id}" ai.maintainRange must be > 0`)
  }

  if (ship.isMs !== undefined && typeof ship.isMs !== 'boolean') {
    throw new Error(`enemyShips.json5: ship "${ship.id}" isMs must be a boolean`)
  }
  if (ship.isMs) {
    if (!ship.pilot || typeof ship.pilot !== 'object') {
      throw new Error(`enemyShips.json5: ship "${ship.id}" isMs rows require a pilot block`)
    }
    if (typeof ship.pilot.reactionSec !== 'number' || ship.pilot.reactionSec <= 0) {
      throw new Error(`enemyShips.json5: ship "${ship.id}" pilot.reactionSec must be a number > 0`)
    }
    if (typeof ship.pilot.aimJitterRad !== 'number' || ship.pilot.aimJitterRad < 0) {
      throw new Error(`enemyShips.json5: ship "${ship.id}" pilot.aimJitterRad must be a number >= 0`)
    }
    if (
      typeof ship.pilot.boostUse !== 'number' || ship.pilot.boostUse < 0 || ship.pilot.boostUse > 1
    ) {
      throw new Error(`enemyShips.json5: ship "${ship.id}" pilot.boostUse must be in [0,1]`)
    }
    if (typeof ship.hitRadiusPx !== 'number' || ship.hitRadiusPx <= 0) {
      throw new Error(`enemyShips.json5: ship "${ship.id}" isMs rows require hitRadiusPx > 0`)
    }
    if (!ship.boost || typeof ship.boost !== 'object') {
      throw new Error(`enemyShips.json5: ship "${ship.id}" isMs rows require a boost block`)
    }
    if (typeof ship.boost.speedMul !== 'number' || ship.boost.speedMul <= 1) {
      throw new Error(`enemyShips.json5: ship "${ship.id}" boost.speedMul must be a number > 1`)
    }
    if (typeof ship.boost.durationSec !== 'number' || ship.boost.durationSec <= 0) {
      throw new Error(`enemyShips.json5: ship "${ship.id}" boost.durationSec must be a number > 0`)
    }
    if (typeof ship.boost.cooldownSec !== 'number' || ship.boost.cooldownSec < 0) {
      throw new Error(`enemyShips.json5: ship "${ship.id}" boost.cooldownSec must be a number >= 0`)
    }
    if (typeof ship.boost.propellantCost !== 'number' || ship.boost.propellantCost < 0) {
      throw new Error(`enemyShips.json5: ship "${ship.id}" boost.propellantCost must be a number >= 0`)
    }
  } else if (ship.pilot !== undefined) {
    throw new Error(`enemyShips.json5: ship "${ship.id}" pilot block is only valid on isMs rows`)
  } else {
    if (ship.hitRadiusPx !== undefined) {
      throw new Error(`enemyShips.json5: ship "${ship.id}" hitRadiusPx is only valid on isMs rows`)
    }
    if (ship.boost !== undefined) {
      throw new Error(`enemyShips.json5: ship "${ship.id}" boost block is only valid on isMs rows`)
    }
  }

  if (!ship.recoverTemplateId || !isShipClassId(ship.recoverTemplateId)) {
    throw new Error(`enemyShips.json5: ship "${ship.id}" recoverTemplateId must reference a ship-classes id`)
  }
  if (!Number.isInteger(ship.crewRequired) || ship.crewRequired <= 0) {
    throw new Error(`enemyShips.json5: ship "${ship.id}" crewRequired must be a positive integer`)
  }

  if (ship.salvage !== undefined) {
    if (!Array.isArray(ship.salvage)) {
      throw new Error(`enemyShips.json5: ship "${ship.id}" salvage must be an array`)
    }
    for (const s of ship.salvage) {
      if (s.kind !== 'weapon' && s.kind !== 'frameMod') {
        throw new Error(`enemyShips.json5: ship "${ship.id}" salvage kind must be 'weapon' | 'frameMod'`)
      }
      const known = s.kind === 'weapon' ? isMsWeaponId(s.partId) : isMsFrameModId(s.partId)
      if (!known) {
        throw new Error(`enemyShips.json5: ship "${ship.id}" salvage partId "${s.partId}" not a known ${s.kind}`)
      }
      if (typeof s.chance !== 'number' || s.chance < 0 || s.chance > 1) {
        throw new Error(`enemyShips.json5: ship "${ship.id}" salvage chance must be in [0,1]`)
      }
      if (!Number.isInteger(s.qty) || s.qty <= 0) {
        throw new Error(`enemyShips.json5: ship "${ship.id}" salvage qty must be a positive integer`)
      }
    }
  }
}

const byId: Record<string, EnemyShipBlueprint> = Object.fromEntries(
  parsed.ships.map((s) => [s.id, s]),
)

export const ENEMY_SHIPS: Record<string, EnemyShipBlueprint> = byId

export const ENEMY_SHIP_LIST: readonly EnemyShipBlueprint[] = parsed.ships

export function getEnemyShip(id: string): EnemyShipBlueprint {
  const def = byId[id]
  if (!def) throw new Error(`Unknown enemy ship id: ${id}`)
  return def
}

export function isEnemyShipId(id: string): boolean {
  return id in byId
}
