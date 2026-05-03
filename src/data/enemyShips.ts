import json5 from 'json5'
import raw from './enemyShips.json5?raw'
import { isSystemId, type SystemId } from './shipSystems'
import { isWeaponId } from './weapons'

// Mirrors the runtime shape of EnemyShipState — Slice G spawns an entity
// with these fields when combat starts.
export interface EnemyShipBlueprint {
  id: string
  nameZh: string
  hullMax: number
  shieldsMax: number
  shieldsRechargeSec: number
  weapons: string[]
  systems: Partial<Record<SystemId, { level: number; integrityPct: number }>>
  rooms: { id: string; nameZh: string; system: SystemId | null }[]
  ai: { aggression: number; retreatThresholdPct: number }
}

interface EnemyShipsFile {
  ships: EnemyShipBlueprint[]
}

const parsed = json5.parse(raw) as EnemyShipsFile

if (!Array.isArray(parsed.ships) || parsed.ships.length === 0) {
  throw new Error('enemyShips.json5 must declare at least one ship')
}

const seen = new Set<string>()
for (const ship of parsed.ships) {
  if (!ship.id) throw new Error('enemyShips.json5: ship missing id')
  if (seen.has(ship.id)) {
    throw new Error(`enemyShips.json5: duplicate ship id "${ship.id}"`)
  }
  seen.add(ship.id)

  if (ship.hullMax <= 0) {
    throw new Error(`enemyShips.json5: ship "${ship.id}" hullMax must be > 0`)
  }
  if (ship.shieldsMax < 0) {
    throw new Error(`enemyShips.json5: ship "${ship.id}" shieldsMax must be >= 0`)
  }
  if (ship.shieldsRechargeSec <= 0 && ship.shieldsMax > 0) {
    throw new Error(
      `enemyShips.json5: ship "${ship.id}" shieldsRechargeSec must be > 0 when shieldsMax > 0`,
    )
  }

  for (const wId of ship.weapons) {
    if (!isWeaponId(wId)) {
      throw new Error(
        `enemyShips.json5: ship "${ship.id}" weapons references unknown weapon "${wId}"`,
      )
    }
  }

  for (const sysId of Object.keys(ship.systems)) {
    if (!isSystemId(sysId)) {
      throw new Error(
        `enemyShips.json5: ship "${ship.id}" systems references unknown system "${sysId}"`,
      )
    }
  }

  const roomIds = new Set<string>()
  for (const room of ship.rooms) {
    if (!room.id) {
      throw new Error(`enemyShips.json5: ship "${ship.id}" room missing id`)
    }
    if (roomIds.has(room.id)) {
      throw new Error(
        `enemyShips.json5: ship "${ship.id}" duplicate room id "${room.id}"`,
      )
    }
    roomIds.add(room.id)
    if (room.system !== null && !isSystemId(room.system)) {
      throw new Error(
        `enemyShips.json5: ship "${ship.id}" room "${room.id}" references unknown system "${room.system}"`,
      )
    }
  }

  if (ship.ai.aggression < 0 || ship.ai.aggression > 1) {
    throw new Error(
      `enemyShips.json5: ship "${ship.id}" ai.aggression must be in [0,1]`,
    )
  }
  if (ship.ai.retreatThresholdPct < 0 || ship.ai.retreatThresholdPct > 1) {
    throw new Error(
      `enemyShips.json5: ship "${ship.id}" ai.retreatThresholdPct must be in [0,1]`,
    )
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
