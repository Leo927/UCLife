// War state (Phase 7.0.B) — the single one-way IsWartime gate plus the
// always-on strategic-war faction-strength model. Lives in the sim layer (a
// module store, mirroring sim/newsfeed.ts and sim/colony.ts) rather than as a
// per-scene ECS trait: the war flag is global, not bound to any one koota
// world, and the multi-world ECS has no global singleton entity to hang it on
// (factionTier scans every scene precisely because of this). Kept off any
// stat sheet per Design/combat.md.
//
// Runtime state is a zustand store so future HUD surfaces can re-render on the
// flip; non-React callers (warTransitionSystem, strategicWarSystem, the save
// handler, debug handles) drive it through the exported helpers.
//
// The flip is one-way: flipToWartime() seeds the strength model from config
// the first time only; subsequent calls are no-ops. War-event resolution is
// idempotent — resolvedEventIds guards against re-applying a delta when a
// rollover fires twice for the same date (tests, load).

import { create } from 'zustand'
import { warTransitionConfig } from '../config'

interface WarStateData {
  isWartime: boolean
  // 1-based game day the gate flipped. 0 = not yet wartime.
  transitionDay: number
  // Per-faction strength, seeded from config on the flip. Empty pre-war.
  factionStrength: Record<string, number>
  // Per-front Federation-vs-Zeon control (0–100), seeded from config on the
  // flip. Empty pre-war.
  frontControl: Record<string, number>
  // War-event ids already resolved (idempotency guard for strategicWarSystem).
  resolvedEventIds: string[]
}

const EMPTY: WarStateData = {
  isWartime: false,
  transitionDay: 0,
  factionStrength: {},
  frontControl: {},
  resolvedEventIds: [],
}

export const useWarState = create<WarStateData>(() => ({ ...EMPTY }))

export function isWartime(): boolean {
  return useWarState.getState().isWartime
}

export function getTransitionDay(): number {
  return useWarState.getState().transitionDay
}

export function getFactionStrength(factionId: string): number {
  return useWarState.getState().factionStrength[factionId] ?? 0
}

export function getFrontControl(frontId: string): number {
  return useWarState.getState().frontControl[frontId] ?? 0
}

export function isWarEventResolved(id: string): boolean {
  return useWarState.getState().resolvedEventIds.includes(id)
}

// Flip the one-way gate and seed the strength model from config. No-op once
// already wartime so the flip — and its config-seeded values — happen exactly
// once regardless of how many rollovers fire on or after the trigger date.
export function flipToWartime(gameDay: number): boolean {
  if (useWarState.getState().isWartime) return false
  const factionStrength: Record<string, number> = { ...warTransitionConfig.initialFactionStrength }
  const frontControl: Record<string, number> = {}
  for (const f of warTransitionConfig.fronts) frontControl[f.id] = f.control
  useWarState.setState({
    isWartime: true,
    transitionDay: gameDay,
    factionStrength,
    frontControl,
  })
  return true
}

// Apply a war event's deltas to the strength model. Clamps front control to
// 0–100; faction strength floors at 0 (a faction can be ground down but not
// negative). Caller owns the idempotency guard (markWarEventResolved).
export function applyStrengthDelta(
  strengthDelta: Record<string, number> | undefined,
  frontShift: Record<string, number> | undefined,
): void {
  const s = useWarState.getState()
  const factionStrength = { ...s.factionStrength }
  const frontControl = { ...s.frontControl }
  if (strengthDelta) {
    for (const [id, d] of Object.entries(strengthDelta)) {
      factionStrength[id] = Math.max(0, (factionStrength[id] ?? 0) + d)
    }
  }
  if (frontShift) {
    for (const [id, d] of Object.entries(frontShift)) {
      frontControl[id] = Math.min(100, Math.max(0, (frontControl[id] ?? 0) + d))
    }
  }
  useWarState.setState({ factionStrength, frontControl })
}

export function markWarEventResolved(id: string): void {
  if (isWarEventResolved(id)) return
  useWarState.setState((s) => ({ resolvedEventIds: [...s.resolvedEventIds, id] }))
}

// ── Persistence ────────────────────────────────────────────────────────────

export interface WarStateSnapshot {
  isWartime: boolean
  transitionDay: number
  factionStrength: Record<string, number>
  frontControl: Record<string, number>
  resolvedEventIds: string[]
}

export function snapshotWarState(): WarStateSnapshot {
  const s = useWarState.getState()
  return {
    isWartime: s.isWartime,
    transitionDay: s.transitionDay,
    factionStrength: { ...s.factionStrength },
    frontControl: { ...s.frontControl },
    resolvedEventIds: [...s.resolvedEventIds],
  }
}

export function restoreWarState(blob: WarStateSnapshot): void {
  useWarState.setState({
    isWartime: Boolean(blob.isWartime),
    transitionDay: blob.transitionDay ?? 0,
    factionStrength: { ...(blob.factionStrength ?? {}) },
    frontControl: { ...(blob.frontControl ?? {}) },
    resolvedEventIds: [...(blob.resolvedEventIds ?? [])],
  })
}

export function resetWarState(): void {
  useWarState.setState({ ...EMPTY, factionStrength: {}, frontControl: {}, resolvedEventIds: [] })
}
