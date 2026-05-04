// Combat + transition + engagement zustand stores, plus fastWinCombat
// (zero the enemy hull so combatSystem ends combat with 'victory' on
// the next tick — keeps space-saveload deterministic without driving
// the weapon-charge state machine through real time).

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { getWorld } from '../../ecs/world'
import {
  Position, EnemyShipState, EnemyAI, EntityKey,
} from '../../ecs/traits'
import { useCombatStore } from '../../systems/combat'
import { useTransition } from '../../sim/transition'
import { useEngagement } from '../../sim/engagement'

registerDebugHandle('useCombatStore', useCombatStore)
registerDebugHandle('useTransition', useTransition)
registerDebugHandle('useEngagement', useEngagement)

registerDebugHandle('fastWinCombat', () => {
  const w = getWorld('playerShipInterior')
  const enemy = w.queryFirst(EnemyShipState)
  if (!enemy) return false
  const cur = enemy.get(EnemyShipState)!
  enemy.set(EnemyShipState, { ...cur, hullCurrent: 0 })
  return true
})

registerDebugHandle('listEnemies', () => {
  const w = getWorld('spaceCampaign')
  const out: { key: string; pos: { x: number; y: number }; mode: string }[] = []
  for (const e of w.query(EnemyAI, Position, EntityKey)) {
    out.push({
      key: e.get(EntityKey)!.key,
      pos: e.get(Position)!,
      mode: e.get(EnemyAI)!.mode,
    })
  }
  return out
})
