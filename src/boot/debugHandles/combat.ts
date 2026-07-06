// Combat + transition + engagement zustand stores, plus fastWinCombat
// (zero the enemy hull so combatSystem ends combat with 'victory' on
// the next tick — keeps space-saveload deterministic without driving
// the weapon-charge state machine through real time).

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { getWorld, SCENE_IDS } from '../../ecs/world'
import type { Entity } from 'koota'
import {
  Position, CombatShipState, EnemyAI, EntityKey, IsPlayer, IsInActiveFleet,
  Ship, WasCaptured, IsFlagshipMark, WeaponMount,
} from '../../ecs/traits'
import {
  useCombatStore, startCombat, combatSystem, endCombat,
  breakDownEnemiesForVictory, getPlayerMountShotCounts, type CombatOutcome,
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
  getPlayerMs, PLAYER_MS_KEY, getAdjutant, onMsDestroyed,
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

// W2 command layer (Task 5) — the fire-mode smoke needs two armed mounts on
// the same ship to prove "hold on mount 0 doesn't block mount 1's auto-fire".
// Every shipped ship class arms every declared mount at boot (Issue #165),
// so this is no longer filling a gap — it's a test-only setter that pins a
// mount's weapon explicitly (independent of the authored default) without
// touching ship-classes.json5 content/balance. The optional firingArcRad
// override lets the volley-targeting smoke guarantee two enemies are
// simultaneously in-arc without depending on live heading.
registerDebugHandle('armWeaponMountForTest', (
  mountIdx: number, weaponId: string, firingArcRad?: number,
): boolean => {
  const w = getWorld('playerShipInterior')
  for (const e of w.query(WeaponMount)) {
    const m = e.get(WeaponMount)!
    if (m.mountIdx !== mountIdx) continue
    e.set(WeaponMount, {
      ...m,
      weaponId,
      chargeSec: 0,
      ready: false,
      firingArcRad: firingArcRad ?? m.firingArcRad,
    })
    return true
  }
  return false
})

// Per-mount shot count + last-fired-at target — the fire-mode smoke's only
// way to observe "did this mount fire" without asserting on hull numbers
// (which auto-fire from other mounts / enemies would also move).
registerDebugHandle('playerMountShotCounts', () => getPlayerMountShotCounts())

// Live enemy key + world position — the volley-targeting smoke reads this
// to aim at a specific enemy without hardcoding spawn-slot math (enemies
// close toward the player over the drive, so spawn coordinates go stale).
registerDebugHandle('combatEnemySnapshot', () => {
  const w = getWorld('playerShipInterior')
  const out: { key: string; pos: { x: number; y: number } }[] = []
  for (const e of w.query(CombatShipState, EntityKey)) {
    const cs = e.get(CombatShipState)!
    if (cs.side !== 'enemy' || cs.isFlagship || cs.isPlayer) continue
    out.push({ key: e.get(EntityKey)!.key, pos: { x: cs.pos.x, y: cs.pos.y } })
  }
  return out
})

registerDebugHandle('combatEntities', () => {
  const w = getWorld('playerShipInterior')
  const out: {
    key: string; side: string; isFlagship: boolean; isMs: boolean; piloted: boolean
    nameZh: string; hull: string; hullCurrent: number; hullMax: number
    // W3 (ms-identity) Task 4 — pilot-AI smoke observability. currentTargetKey
    // mirrors the reaction-gated committed target (see systems/combat.ts §1);
    // boostCooldownSec > 0 is evidence a boost was triggered at some point
    // this engagement (it's set to durationSec+cooldownSec on activation).
    currentTargetKey: string; boostCooldownSec: number
  }[] = []
  for (const e of w.query(CombatShipState)) {
    const cs = e.get(CombatShipState)!
    out.push({
      key: e.get(EntityKey)?.key ?? '',
      side: cs.side,
      isFlagship: cs.isFlagship,
      isMs: cs.isMs,
      piloted: cs.pilotedByPlayer,
      nameZh: cs.nameZh,
      hull: `${cs.hullCurrent}/${cs.hullMax}`,
      hullCurrent: cs.hullCurrent,
      hullMax: cs.hullMax,
      currentTargetKey: cs.currentTargetKey,
      boostCooldownSec: cs.boostCooldownSec,
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
    armorCurrent: cs.armorCurrent,
    armorMax: cs.armorMax,
    pilotedByPlayer: cs.pilotedByPlayer,
  }
})

// W3 (ms-identity) Task 5 — deterministically place a combat row (flagship,
// enemy, MS, or wing) so the wing role-targeting smoke can pin exact
// distances without depending on spawn-slot geometry. Zeros velocity so the
// unit holds the seeded pose for the tick under assertion.
registerDebugHandle('setCombatPosCheat', (entityKey: string, x: number, y: number): boolean => {
  const w = getWorld('playerShipInterior')
  for (const e of w.query(CombatShipState, EntityKey)) {
    if (e.get(EntityKey)!.key !== entityKey) continue
    const cs = e.get(CombatShipState)!
    e.set(CombatShipState, { ...cs, pos: { x, y }, vel: { x: 0, y: 0 } })
    return true
  }
  return false
})

// W3 (ms-identity) Task 5 — deterministically damage a launched wing's
// tactical clone (keyed `wing-<rosterKey>`) so the wing damage-sync smoke can
// assert the write-back onto its own roster row (dock sync + endCombat sync).
registerDebugHandle('setWingHullCheat', (
  rosterKey: string, hullCurrent: number, armorCurrent: number,
): boolean => {
  const w = getWorld('playerShipInterior')
  const cloneKey = `wing-${rosterKey}`
  for (const e of w.query(CombatShipState, EntityKey)) {
    if (e.get(EntityKey)!.key !== cloneKey) continue
    e.set(CombatShipState, { ...e.get(CombatShipState)!, hullCurrent, armorCurrent })
    return true
  }
  return false
})

// W3 (ms-identity) Task 5 — snapshot every launched wing's clone row + its
// roster mapping so the smoke can read targeting + hull without stripping
// key prefixes inline.
registerDebugHandle('getWings', (): Array<{
  cloneKey: string; rosterKey: string; currentTargetKey: string
  hullCurrent: number; hullMax: number; pos: { x: number; y: number }
}> => {
  const w = getWorld('playerShipInterior')
  const out: Array<{
    cloneKey: string; rosterKey: string; currentTargetKey: string
    hullCurrent: number; hullMax: number; pos: { x: number; y: number }
  }> = []
  for (const e of w.query(CombatShipState, EntityKey)) {
    const key = e.get(EntityKey)!.key
    if (!key.startsWith('wing-')) continue
    const cs = e.get(CombatShipState)!
    out.push({
      cloneKey: key,
      rosterKey: key.slice('wing-'.length),
      currentTargetKey: cs.currentTargetKey,
      hullCurrent: cs.hullCurrent,
      hullMax: cs.hullMax,
      pos: { x: cs.pos.x, y: cs.pos.y },
    })
  }
  return out
})

// Issue #163 — deterministically damage the piloted MS's tactical clone
// without driving real weapon-charge/projectile timing, so the roster
// write-back smoke can assert an exact before/after hull+armor delta.
registerDebugHandle('setPilotedMsHullCheat', (hullCurrent: number, armorCurrent: number): boolean => {
  const e = getPlayerMs()
  if (!e) return false
  e.set(CombatShipState, { ...e.get(CombatShipState)!, hullCurrent, armorCurrent })
  return true
})

// Issue #163 — drive the destruction write-back exit directly, mirroring
// how combatSystem calls onMsDestroyed() once a hit drops the clone's
// hull to the eject floor. Pair with setPilotedMsHullCheat(0, 0).
registerDebugHandle('onMsDestroyedCheat', (): boolean => {
  if (!getPlayerMs()) return false
  onMsDestroyed()
  return true
})
