import json5 from 'json5'
import raw from './space-entities.json5?raw'
import { isEnemyShipId } from './enemyShips'

// Hand-placed persistent enemies in the campaign sector. Pure data + types
// — slice 5 reads this to spawn koota entities at world boot. There is
// no RNG encounter system; every threat is one of these entries.

export type SpaceEntityKind = 'enemyShip'

export type EnemyAiMode = 'patrol' | 'idle'

export interface SpacePos {
  x: number
  y: number
}

export interface SpaceEntity {
  id: string
  kind: SpaceEntityKind
  shipClassId: string
  // Optional escort ship class IDs that join the lead in tactical
  // combat. Empty/missing = solo encounter. Each escort spawns its
  // own EnemyShipState in the arena alongside the lead.
  escorts?: string[]
  spawn: SpacePos
  aiMode: EnemyAiMode
  patrolPath?: SpacePos[]
  aggroRadius: number
  fleeHullPct: number
}

interface SpaceEntitiesFile {
  entities: SpaceEntity[]
}

const SECTOR_W = 30000
const SECTOR_H = 24000

const parsed = json5.parse(raw) as SpaceEntitiesFile

const byId = new Map<string, SpaceEntity>()

for (const e of parsed.entities) {
  if (!e.id || typeof e.id !== 'string') {
    throw new Error('space-entities.json5: entity missing id')
  }
  if (byId.has(e.id)) {
    throw new Error(`space-entities.json5: duplicate id "${e.id}"`)
  }
  if (!e.spawn || typeof e.spawn.x !== 'number' || typeof e.spawn.y !== 'number') {
    throw new Error(`space-entities.json5: entity "${e.id}" missing spawn {x,y}`)
  }
  if (e.spawn.x < 0 || e.spawn.x > SECTOR_W || e.spawn.y < 0 || e.spawn.y > SECTOR_H) {
    throw new Error(
      `space-entities.json5: entity "${e.id}" spawn out of sector envelope (got ${e.spawn.x}, ${e.spawn.y})`,
    )
  }
  if (typeof e.aggroRadius !== 'number' || e.aggroRadius <= 0) {
    throw new Error(`space-entities.json5: entity "${e.id}" needs positive aggroRadius`)
  }
  if (typeof e.fleeHullPct !== 'number' || e.fleeHullPct < 0 || e.fleeHullPct > 1) {
    throw new Error(`space-entities.json5: entity "${e.id}" fleeHullPct must be in [0,1]`)
  }
  if (e.aiMode !== 'patrol' && e.aiMode !== 'idle') {
    throw new Error(`space-entities.json5: entity "${e.id}" has unknown aiMode "${e.aiMode}"`)
  }
  if (!isEnemyShipId(e.shipClassId)) {
    throw new Error(`space-entities.json5: entity "${e.id}" references unknown shipClassId "${e.shipClassId}"`)
  }
  if (e.escorts !== undefined) {
    if (!Array.isArray(e.escorts)) {
      throw new Error(`space-entities.json5: entity "${e.id}" escorts must be an array`)
    }
    for (const esc of e.escorts) {
      if (typeof esc !== 'string' || !isEnemyShipId(esc)) {
        throw new Error(`space-entities.json5: entity "${e.id}" escort "${esc}" not in enemyShips.json5`)
      }
    }
  }
  if (e.aiMode === 'patrol' && (!e.patrolPath || e.patrolPath.length < 2)) {
    throw new Error(`space-entities.json5: entity "${e.id}" patrol path needs >= 2 points`)
  }
  if (e.patrolPath) {
    for (const pt of e.patrolPath) {
      if (typeof pt.x !== 'number' || typeof pt.y !== 'number') {
        throw new Error(`space-entities.json5: entity "${e.id}" patrolPath has malformed point`)
      }
      if (pt.x < 0 || pt.x > SECTOR_W || pt.y < 0 || pt.y > SECTOR_H) {
        throw new Error(
          `space-entities.json5: entity "${e.id}" patrol point out of sector envelope`,
        )
      }
    }
  }
  byId.set(e.id, e)
}

export const SPACE_ENTITIES: readonly SpaceEntity[] = parsed.entities

export function getSpaceEntity(id: string): SpaceEntity | undefined {
  return byId.get(id)
}
