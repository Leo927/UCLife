// Combat + transition + engagement zustand stores, plus fastWinCombat
// (zero the enemy hull so combatSystem ends combat with 'victory' on
// the next tick — keeps space-saveload deterministic without driving
// the weapon-charge state machine through real time).

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { getWorld, SCENE_IDS } from '../../ecs/world'
import type { Entity } from 'koota'
import {
  Position, CombatShipState, EnemyAI, EntityKey, IsPlayer, IsInActiveFleet,
  Ship, WasCaptured, IsFlagshipMark,
} from '../../ecs/traits'
import {
  useCombatStore, startCombat, combatSystem, endCombat,
  breakDownEnemiesForVictory, type CombatOutcome,
} from '../../systems/combat'
import {
  issueRally, issueFocusFire, issueRegroup, activeOrders,
} from '../../systems/fleetOrders'
import {
  capturePrisoner, interrogatePrisoner, ransomPrisoner, recruitPrisoner,
  executePrisoner, handOverPrisoner, releasePrisoner, tickBrigConditionsNow,
} from '../../systems/prisoners'
import {
  getRecoverables, recoverHull, salvageHull, scuttleHull, recoverPod,
  leavePod, canRecoverHull, finishRecoverables,
} from '../../systems/recoverables'
import { onFlagshipDock } from '../../systems/fleetLaunch'
import { getRep } from '../../systems/reputation'
import { useTransition } from '../../sim/transition'
import { useEngagement } from '../../sim/engagement'
import {
  useCockpit, launchMs, dockMs, takeFlagshipControl, leaveBridge,
  getPlayerMs, PLAYER_MS_KEY, getAdjutant,
} from '../../sim/cockpit'
import { useBrig, getBrigOccupancy } from '../../sim/brig'
import { useUI } from '../../ui/uiStore'

function findAnyPlayer(): Entity | undefined {
  for (const id of SCENE_IDS) {
    const e = getWorld(id).queryFirst(IsPlayer)
    if (e) return e
  }
  return undefined
}

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

// Test-mode driver: combatSystem runs from the RAF loop in prod, but
// the loop is stopped under ?test=1. Call this to advance combat by
// `dtMs` of tactical time. Pair with fastWinCombat() to resolve.
registerDebugHandle('tickCombatSystem', (dtMs: number) => {
  combatSystem(getWorld('playerShipInterior'), dtMs)
  return true
})

// Test-mode shortcut: force combat to resolve immediately with the
// given outcome. Used by smoke tests that don't want to drive the
// tactical loop frame-by-frame.
registerDebugHandle('endCombatCheat', (outcome: CombatOutcome) => {
  endCombat(outcome)
  return true
})

// Issue #64 — break down every hostile through the canonical
// onEnemyDestroyed → destroy → endCombat('victory') path, so the
// salvage roll + tally routing fire deterministically without driving
// weapon-charge timing. Distinct from fastWinCombat (which only zeroes
// hull and leaves the kill to the tactical loop's auto-fire).
registerDebugHandle('breakDownEnemiesCheat', () => {
  breakDownEnemiesForVictory()
  return true
})

// W2 command layer — drive a fleet order without a UI surface. `point` /
// `enemyKey` are only read for the matching `kind`; the smoke passes the
// whole payload through to the corresponding issue* function.
type FleetOrderDebugPayload =
  | { kind: 'rally'; point: { x: number; y: number } }
  | { kind: 'focusFire'; enemyKey: string }
  | { kind: 'regroup' }
registerDebugHandle('issueFleetOrderDebug', (order: FleetOrderDebugPayload) => {
  if (order.kind === 'rally') return issueRally(order.point)
  if (order.kind === 'focusFire') return issueFocusFire(order.enemyKey)
  return issueRegroup()
})

// Read-only mirror of the standing fleet orders (rallyPoint/focusTargetKey).
registerDebugHandle('fleetOrdersDescribe', () => activeOrders())

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
      factionId: p.factionId,
      provision: p.provision,
      entityKey: p.entityKey,
    })),
  }
})
registerDebugHandle('clearBrig', () => { useBrig.getState().reset(); return true })
registerDebugHandle('forceCapture', (npcId: string, factionId: string = 'pirate') => {
  return capturePrisoner({
    id: npcId,
    nameZh: npcId,
    contextZh: '(forced)',
    factionId,
  })
})

// Issue #70 — prisoner verb handles. Each resolves through the single
// systems/prisoners.ts implementation (shared by the brig walk-up panel
// and the comm-panel face wall) and returns the structured VerbResult so
// the smoke can assert credits + per-faction rep deltas deterministically.
registerDebugHandle('prisonerInterrogate', (id: string) => interrogatePrisoner(id))
registerDebugHandle('prisonerRansom', (id: string) => ransomPrisoner(id))
registerDebugHandle('prisonerRecruit', (id: string) => recruitPrisoner(id))
registerDebugHandle('prisonerExecute', (id: string) => executePrisoner(id))
registerDebugHandle('prisonerHandOver', (id: string) => handOverPrisoner(id))
registerDebugHandle('prisonerRelease', (id: string) => releasePrisoner(id))
// Advance the in-flight brig-condition upkeep tick once at the current
// game day (decay provisioning → onset brig_neglect; resolve neglect
// deaths / escapes). The shared physiology day tick (physiologyTickDay)
// advances brig_neglect toward the fatal peak between calls.
registerDebugHandle('brigConditionTick', () => { tickBrigConditionsNow(); return true })
// Player reputation readback by faction (for the rep-delta assertions).
registerDebugHandle('playerRepByFaction', (factionId: string) => {
  const p = findAnyPlayer()
  if (!p) return null
  return getRep(p, factionId as never)
})

// Issue #71 — recoverables dialogue handles. The smoke drives the
// post-combat hull / pod resolution through these and asserts the new
// reserve ship's in-flight state + the brig occupancy bump.
registerDebugHandle('getRecoverables', () => getRecoverables())
registerDebugHandle('canRecoverHull', (id: string) => canRecoverHull(id))
registerDebugHandle('recoverHull', (id: string) => recoverHull(id))
registerDebugHandle('salvageHull', (id: string) => salvageHull(id))
registerDebugHandle('scuttleHull', (id: string) => scuttleHull(id))
registerDebugHandle('recoverPod', (id: string) => recoverPod(id))
registerDebugHandle('leavePod', (id: string) => leavePod(id))
registerDebugHandle('finishRecoverables', () => { finishRecoverables(); return true })
// Dock the flagship at a POI (drives the captured-hull → delivery routing).
registerDebugHandle('flagshipDockCheat', (poiId: string) => onFlagshipDock(poiId))
// Seed the flagship's crew pool to a known count so the prize-crew gate
// (idle flagship crew ≥ ceil(crewRequired / divisor)) is deterministic.
registerDebugHandle('setFlagshipCrewCount', (n: number) => {
  const fs = getWorld('playerShipInterior').queryFirst(Ship, IsFlagshipMark)
  if (!fs) return false
  const s = fs.get(Ship)!
  const crewIds = Array.from({ length: Math.max(0, n) }, (_, i) => `prize-crew-${i}`)
  fs.set(Ship, { ...s, crewIds })
  return true
})
// Inspect captured ships in playerShipInterior — the in-flight state the
// recoverables smoke asserts (WasCaptured / homeHangarId / half bunkers).
registerDebugHandle('capturedShips', () => {
  const w = getWorld('playerShipInterior')
  const out: Array<{
    key: string; templateId: string; wasCaptured: boolean
    homeHangarId: string; currentSupply: number; currentFuel: number
    inActiveFleet: boolean
  }> = []
  for (const e of w.query(Ship, EntityKey)) {
    if (!e.has(WasCaptured)) continue
    const s = e.get(Ship)!
    out.push({
      key: e.get(EntityKey)!.key,
      templateId: s.templateId,
      wasCaptured: true,
      homeHangarId: s.homeHangarId,
      currentSupply: s.currentSupply,
      currentFuel: s.currentFuel,
      inActiveFleet: e.has(IsInActiveFleet),
    })
  }
  return out
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
