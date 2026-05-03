import json5 from 'json5'
import raw from './enemyShips.json5?raw'
import { isWeaponId, getWeapon } from './weapons'
import type { MountSize } from './weapons'

// Enemy ship blueprint — Starsector-shape stat block. Combat spawns an
// EnemyShipState entity from one of these.

export interface EnemyMountDef {
  idx: number
  size: MountSize
  arc: number
  facing: number
}

export interface EnemyShipBlueprint {
  id: string
  nameZh: string
  descZh: string
  hullMax: number
  armorMax: number
  fluxMax: number
  fluxDissipation: number
  shieldEfficiency: number
  topSpeed: number
  maneuverability: number
  mounts: EnemyMountDef[]
  defaultWeapons: string[]
  ai: {
    aggression: number
    retreatThresholdPct: number
    maintainRange: number
  }
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
  if (ship.topSpeed < 0) throw new Error(`enemyShips.json5: ship "${ship.id}" topSpeed must be >= 0`)
  if (ship.maneuverability < 0 || ship.maneuverability > 2) {
    throw new Error(`enemyShips.json5: ship "${ship.id}" maneuverability must be in [0,2]`)
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
  }

  if (ship.defaultWeapons.length > ship.mounts.length) {
    throw new Error(
      `enemyShips.json5: ship "${ship.id}" has ${ship.defaultWeapons.length} weapons but only ${ship.mounts.length} mounts`,
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
