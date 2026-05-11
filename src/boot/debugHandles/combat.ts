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
  getPlayerMs, PLAYER_MS_KEY, getAdjutant,
} from '../../sim/cockpit'
import { useBrig, getBrigOccupancy } from '../../sim/brig'
import { useUI } from '../../ui/uiStore'

registerDebugHandle('useCombatStore', useCombatStore)
registerDebugHandle('useTransition', useTransition)
registerDebugHandle('useEngagement', useEngagement)

// Skip the contact-detection + modal flow for smoke tests / dev poking —
// jump straight into a tactical engagement against the named enemy class.
// The optional escortIds arg lists wingmen that join the lead in the arena.
// The campaignEnemyKey arg is the spaceCampaign EntityKey of the lead (so
// victory can clean up the right pirate); omit for synthetic combat.
// notableCaptains pins special-NPC ids to fleet slots (lead = '0') so the
// post-combat capture flow fires; pass `{}` for anonymous encounters.
registerDebugHandle('startCombatCheat', (
  enemyShipId: string,
  escortIds: string[] = [],
  campaignEnemyKey: string | null = null,
  notableCaptains: Record<string, string> = {},
) => {
  startCombat(enemyShipId, escortIds, campaignEnemyKey, notableCaptains)
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

// Phase 6.2 brig + comm-panel handles. Smoke tests drive the named-
// hostile capture loop end-to-end via these. `forceCapture` short-
// circuits the combat layer when verifying the brig record + tally
// payload without staging an actual destruction sequence.
registerDebugHandle('useBrig', useBrig)
registerDebugHandle('brigState', () => {
  const { occupied, capacity } = getBrigOccupancy()
  return {
    occupied,
    capacity,
    prisoners: useBrig.getState().prisoners.map((p) => ({
      id: p.id,
      nameZh: p.nameZh,
      titleZh: p.titleZh,
    })),
  }
})
registerDebugHandle('clearBrig', () => { useBrig.getState().reset(); return true })
registerDebugHandle('forceCapture', (npcId: string) => {
  return useBrig.getState().add({
    id: npcId,
    nameZh: npcId,
    contextZh: '(forced)',
    factionId: 'pirate',
    capturedAtMs: performance.now(),
  })
})
registerDebugHandle('getAdjutant', () => getAdjutant())
registerDebugHandle('openCommPanel', () => { useUI.getState().setCommPanel(true); return true })
registerDebugHandle('openBrigPanel', () => { useUI.getState().setBrigPanel(true); return true })

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
