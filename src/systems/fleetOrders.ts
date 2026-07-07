// W2 command layer, Task 1 — fleet-order effects. `issueFleetOrder()` in
// fleetCommandPoints.ts already debits CP + refuses on an empty pool, but
// has no gameplay effect of its own. This module is the thin state layer
// that gives rally / focus-fire / regroup a real, consumable effect:
// combat.ts's unified per-ship AI directive reads `activeOrders()` every
// tick to steer + aim active-fleet escorts; `startCombat` calls
// `resetFleetOrders()` so a fresh engagement always starts order-free.
//
// `regroup` spends the `formationChange` CP cost (Design/fleet.md's
// command vocabulary has no separate "regroup" cost row — clearing rally +
// focus IS the formation-change order).

import { create } from 'zustand'
import type { Entity } from 'koota'
import { CombatShipState, EntityKey } from '../ecs/traits'
import { getWorld } from '../ecs/world'
import { issueFleetOrder, type OrderResult } from './fleetCommandPoints'
import { useCpDp } from './fleetCommandPoints'
import { countLaunchableWings, launchWings } from './msWings'
import { pushCombatLog } from '../sim/combatLog'

const SHIP_SCENE_ID = 'playerShipInterior'

export type FleetOrderId = 'rally' | 'focusFire' | 'regroup'

export interface FleetOrdersState {
  rallyPoint: { x: number; y: number } | null
  focusTargetKey: string | null
}

interface FleetOrdersStore extends FleetOrdersState {
  setRallyPoint: (point: { x: number; y: number } | null) => void
  setFocusTargetKey: (key: string | null) => void
  reset: () => void
}

const useFleetOrdersStore = create<FleetOrdersStore>((set) => ({
  rallyPoint: null,
  focusTargetKey: null,
  setRallyPoint: (rallyPoint) => set({ rallyPoint }),
  setFocusTargetKey: (focusTargetKey) => set({ focusTargetKey }),
  reset: () => set({ rallyPoint: null, focusTargetKey: null }),
}))

// The focus-fire log line names the target; fall back to the raw key when
// no live enemy CombatShipState resolves it (e.g. a caller-supplied key
// that never matched a spawned hostile).
function resolveEnemyNameZh(enemyKey: string): string {
  const w = getWorld(SHIP_SCENE_ID)
  for (const e of w.query(CombatShipState, EntityKey) as Iterable<Entity>) {
    if (e.get(EntityKey)!.key !== enemyKey) continue
    const cs = e.get(CombatShipState)!
    if (cs.side === 'enemy') return cs.nameZh
  }
  return enemyKey
}

export function issueRally(point: { x: number; y: number }): OrderResult {
  const result = issueFleetOrder('rally')
  if (result.ok) {
    useFleetOrdersStore.getState().setRallyPoint(point)
    pushCombatLog('集结指令 · 舰队向指定坐标机动', 'info')
  }
  return result
}

export function issueFocusFire(enemyKey: string): OrderResult {
  const result = issueFleetOrder('focusFire')
  if (result.ok) {
    useFleetOrdersStore.getState().setFocusTargetKey(enemyKey)
    pushCombatLog(`集火指令 · 目标 ${resolveEnemyNameZh(enemyKey)}`, 'info')
  }
  return result
}

export function issueRegroup(): OrderResult {
  const result = issueFleetOrder('formationChange')
  if (result.ok) {
    useFleetOrdersStore.getState().reset()
    pushCombatLog('重整队形 · 各舰返回编队位', 'info')
  }
  return result
}

// W3 (ms-identity) Task 5 — MS launch authorization. Debits the msLaunchAuth
// CP cost (2, per fleet.json5 orderCosts) and launches every pilot-assigned
// MS stored aboard the flagship as an AI wing. Refuses without debiting when
// no MS is launchable (the palette button is disabled in that state, but the
// guard keeps a debit from being wasted). Wing spawning + the resupply loop
// live in systems/msWings.ts.
export function issueMsLaunchAuth(): OrderResult {
  if (countLaunchableWings() === 0) {
    return { ok: false, reason: 'no_launchable_ms', remaining: useCpDp.getState().cpCurrent }
  }
  const result = issueFleetOrder('msLaunchAuth')
  if (result.ok) {
    const n = launchWings()
    pushCombatLog(`出击授权 · ${n} 机僚机升空`, 'info')
  }
  return result
}

export function activeOrders(): FleetOrdersState {
  const s = useFleetOrdersStore.getState()
  return { rallyPoint: s.rallyPoint, focusTargetKey: s.focusTargetKey }
}

export function resetFleetOrders(): void {
  useFleetOrdersStore.getState().reset()
}

// combat.ts's per-tick directive calls this when a standing focus-fire
// order's target has died or left the engagement, so the escort falls back
// to nearest-hostile targeting. Clearing here (rather than in combat.ts)
// keeps the order's issue/clear halves in one module; combat.ts owns the
// one-shot "目标已失去" log line since that's a tactical narration concern.
export function clearStaleFocusTarget(): void {
  useFleetOrdersStore.getState().setFocusTargetKey(null)
}
