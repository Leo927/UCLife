// War-transition orchestrator (Phase 7.0.B). Runs once per game-day on
// day:rollover:settled (wired in boot/warTransitionTick.ts). The structural
// pivot of the whole game: a single one-way flag flip at UC 0079.01.03 that
// every downstream war slice (7.0.C/D/E) reads.
//
// Gate: clock on or after the configured trigger date AND not already wartime.
// Mirrors the factionTier one-way-gate shape — "exactly once" is the
// !isWartime guard, not edge detection, so jumping the clock directly onto or
// past the date (load, tests) still flips correctly.
//
// On the flip, run the ordered transition steps (Design/combat.md § The
// Phase 7 transition): seed the strategic-war model, fire the 7.0.A war-day
// force-toast, then emit the transition event the downstream slices subscribe
// to. This file ships the dispatch + the flip; the subscribers are their own
// slices.
//
// Perf: O(1) — one ordinal compare + a config-sized seed on the single flip
// day, no per-frame scan. Runs on the daily tick. Target N: 1 player world.

import { ucDateOrdinal, ucDateKeyOrdinal } from '../data/news'
import { warTransitionConfig } from '../config'
import { isWartime, flipToWartime } from '../sim/warState'
import { fireWarDayToast } from '../sim/newsfeed'
import { emitSim } from '../sim/events'

export interface WarTransitionResult {
  // Whether this call performed the one-way flip (true only on the flip day).
  flipped: boolean
  isWartime: boolean
}

export function warTransitionSystem(date: Date, gameDay: number): WarTransitionResult {
  if (isWartime()) return { flipped: false, isWartime: true }

  const triggerOrdinal = ucDateKeyOrdinal(warTransitionConfig.triggerDateKey)
  if (ucDateOrdinal(date) < triggerOrdinal) return { flipped: false, isWartime: false }

  // ── Ordered transition steps ──────────────────────────────────────────
  // 1. Start the strategic-war model churning (seed strengths + fronts).
  flipToWartime(gameDay)
  // 2. Fire the 7.0.A war-day force-toast — the Operation British broadcast
  //    that reaches every screen regardless of player location.
  fireWarDayToast()
  // 3. Notify the downstream slices (conscription, warPayoff, civilian war).
  emitSim('war:transition', { gameDay })

  return { flipped: true, isWartime: true }
}
