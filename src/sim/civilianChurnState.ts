// Civilian-churn state (Phase 7.0.E.2) — the roster of non-combatant named
// NPCs that have already churned out of the city (fled or killed offscreen)
// plus the last roll day driving the cadence. A sim-layer module store
// (mirroring sim/conscriptionState.ts): global, not a per-scene ECS trait, and
// the only consumer is the civilian-churn system, so it stays out of the
// character traits.
//
// The churned set is persisted so a roll stays idempotent across save/load (a
// churned NPC is never re-counted or re-logged). Note the world's own save
// diff already keeps a destroyed NPC gone after a reload — see src/save/index.ts
// (it destroys any reset-spawned entity the snapshot doesn't expect) — so this
// set is bookkeeping, not the re-removal mechanism.

import { create } from 'zustand'

interface CivilianChurnStateData {
  // Names of non-combatant named NPCs already churned out.
  churned: Set<string>
  // 1-based game day the last churn roll ran (0 = never). Drives the cadence.
  lastRollDay: number
}

const EMPTY: CivilianChurnStateData = {
  churned: new Set<string>(),
  lastRollDay: 0,
}

export const useCivilianChurn = create<CivilianChurnStateData>(() => ({
  churned: new Set<string>(),
  lastRollDay: 0,
}))

export function isChurned(name: string): boolean {
  return useCivilianChurn.getState().churned.has(name)
}

export function markChurned(name: string): void {
  useCivilianChurn.setState((s) => {
    const churned = new Set(s.churned)
    churned.add(name)
    return { churned }
  })
}

export function getChurnedNames(): string[] {
  return Array.from(useCivilianChurn.getState().churned)
}

export function getChurnLastRollDay(): number {
  return useCivilianChurn.getState().lastRollDay
}

export function markChurnRollDay(gameDay: number): void {
  useCivilianChurn.setState({ lastRollDay: gameDay })
}

// ── Persistence ────────────────────────────────────────────────────────────

export interface CivilianChurnSnapshot {
  churned: string[]
  lastRollDay: number
}

export function snapshotCivilianChurn(): CivilianChurnSnapshot {
  const s = useCivilianChurn.getState()
  return { churned: Array.from(s.churned), lastRollDay: s.lastRollDay }
}

export function restoreCivilianChurn(blob: CivilianChurnSnapshot): void {
  useCivilianChurn.setState({
    churned: new Set(blob.churned ?? []),
    lastRollDay: blob.lastRollDay ?? 0,
  })
}

export function resetCivilianChurn(): void {
  useCivilianChurn.setState({ ...EMPTY, churned: new Set<string>() })
}
