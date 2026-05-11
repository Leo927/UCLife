// Phase 6.0 — combat event log. Starsector-shape top-left fading scroll
// that surfaces routine status changes during a tactical engagement.
// Replaces auto-pause for events that don't deserve to halt the fight:
// hull/armor thresholds (sub-flagship), weapon depletions, enemy
// destruction, named-officer chatter, etc.
//
// Severity tiers (info / warn / crit / narr) drive the entry's
// left-border color. `pushedAtMs` is performance.now() so the renderer
// can fade entries after `combatLogVisibleSec`. Entries persist in
// `history` even after the visible window expires — Tab toggles a
// scrollable full-history view in the TacticalView UI.
//
// Cleared by `startCombat` so each engagement starts with an empty log.

import { create } from 'zustand'
import { combatConfig } from '../config'

export type CombatLogSeverity = 'info' | 'warn' | 'crit' | 'narr'

export interface CombatLogEntry {
  id: number
  textZh: string
  severity: CombatLogSeverity
  pushedAtMs: number
}

interface CombatLogState {
  entries: CombatLogEntry[]
  historyOpen: boolean
  toggleHistory: () => void
  setHistoryOpen: (open: boolean) => void
  push: (textZh: string, severity: CombatLogSeverity) => void
  clear: () => void
}

let counter = 0

export const useCombatLog = create<CombatLogState>((set) => ({
  entries: [],
  historyOpen: false,
  toggleHistory: () => set((s) => ({ historyOpen: !s.historyOpen })),
  setHistoryOpen: (historyOpen) => set({ historyOpen }),
  push: (textZh, severity) => set((s) => {
    const id = ++counter
    const next = [...s.entries, {
      id, textZh, severity, pushedAtMs: performance.now(),
    }]
    if (next.length > combatConfig.logMaxEntries) {
      next.splice(0, next.length - combatConfig.logMaxEntries)
    }
    return { entries: next }
  }),
  clear: () => set({ entries: [], historyOpen: false }),
}))

export function pushCombatLog(textZh: string, severity: CombatLogSeverity): void {
  useCombatLog.getState().push(textZh, severity)
}
