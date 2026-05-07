// Combat + transition + engagement zustand stores, plus fastWinCombat
// (zero the enemy hull so combatSystem ends combat with 'victory' on
// the next tick — keeps space-saveload deterministic without driving
// the weapon-charge state machine through real time).

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { getWorld } from '../../ecs/world'
import {
  Position, CombatShipState, EnemyAI, EntityKey,
} from '../../ecs/traits'
import { useCombatStore, startCombat } from '../../systems/combat'
import { useTransition } from '../../sim/transition'
import { useEngagement } from '../../sim/engagement'

registerDebugHandle('useCombatStore', useCombatStore)
registerDebugHandle('useTransition', useTransition)
registerDebugHandle('useEngagement', useEngagement)

// Skip the contact-detection + modal flow for smoke tests / dev poking —
// jump straight into a tactical engagement against the named enemy class.
// The optional escortIds arg lists wingmen that join the lead in the arena.
// The campaignEnemyKey arg is the spaceCampaign EntityKey of the lead (so
// victory can clean up the right pirate); omit for synthetic combat.
registerDebugHandle('startCombatCheat', (
  enemyShipId: string,
  escortIds: string[] = [],
  campaignEnemyKey: string | null = null,
) => {
  startCombat(enemyShipId, escortIds, campaignEnemyKey)
  return true
})

registerDebugHandle('fastWinCombat', () => {
  const w = getWorld('playerShipInterior')
  let touched = false
  for (const enemy of w.query(CombatShipState)) {
    const cur = enemy.get(CombatShipState)!
    if (cur.isPlayer) continue   // player hull lives on Ship trait, not CombatShipState
    enemy.set(CombatShipState, { ...cur, hullCurrent: 0 })
    touched = true
  }
  return touched
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
