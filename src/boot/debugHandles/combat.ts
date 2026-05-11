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
import {
  useCockpit, launchMs, dockMs, takeFlagshipControl, leaveBridge,
  getPlayerMs, PLAYER_MS_KEY,
} from '../../sim/cockpit'

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

// Phase 6.1 cockpit + bridge-walk handles. Smoke tests drive these to
// exercise launch/dock/leave-bridge without going through the in-game
// hangar interactable + walk path.
registerDebugHandle('useCockpit', useCockpit)
registerDebugHandle('launchPlayerMs', () => launchMs())
registerDebugHandle('dockPlayerMs', (force: boolean = false) => dockMs({ force }))
registerDebugHandle('takeFlagshipControl', () => takeFlagshipControl())
registerDebugHandle('leaveBridgeCheat', () => { leaveBridge(); return true })

registerDebugHandle('combatEntities', () => {
  const w = getWorld('playerShipInterior')
  const out: { side: string; isFlagship: boolean; isMs: boolean; piloted: boolean; nameZh: string; hull: string }[] = []
  for (const e of w.query(CombatShipState)) {
    const cs = e.get(CombatShipState)!
    out.push({
      side: cs.side,
      isFlagship: cs.isFlagship,
      isMs: cs.isMs,
      piloted: cs.pilotedByPlayer,
      nameZh: cs.nameZh,
      hull: `${cs.hullCurrent}/${cs.hullMax}`,
    })
  }
  return out
})

registerDebugHandle('msState', () => {
  const e = getPlayerMs()
  if (!e) return null
  const cs = e.get(CombatShipState)!
  return {
    key: PLAYER_MS_KEY,
    nameZh: cs.nameZh,
    pos: { x: cs.pos.x, y: cs.pos.y },
    vel: { x: cs.vel.x, y: cs.vel.y },
    heading: cs.heading,
    hullCurrent: cs.hullCurrent,
    hullMax: cs.hullMax,
    pilotedByPlayer: cs.pilotedByPlayer,
  }
})
