// Strategic-war model resolution (Phase 7.0.B). Once wartime, resolves the
// date-keyed war events whose `date` matches the current UC date against the
// warState faction-strength model, then publishes each outcome on the event
// bus for downstream consumers (newsfeed entries, economy shocks, NPC drives
// — 7.0.C/D/E). Runs once per game-day on day:rollover:settled, after the
// transition orchestrator (so the model is seeded before the first resolve).
//
// Idempotent: each event is resolved at most once (warState.resolvedEventIds),
// so a forced re-tick or a load that re-runs the rollover never double-applies
// a delta.
//
// Perf: O(events matching today's date) — a fixed handful per game-day. No
// per-frame scan, no scan over entities of a class. Target N: ~4 factions ×
// a few fronts; sub-budget on the daily tick.

import { ucDateKey } from '../data/news'
import { getWarEventsForDate } from '../data/warEvents'
import {
  isWartime, isWarEventResolved, applyStrengthDelta, markWarEventResolved,
} from '../sim/warState'
import { emitSim } from '../sim/events'

export interface StrategicWarResult {
  // Ids of the war events resolved by this call (empty pre-war or on a date
  // with no unresolved events).
  resolved: string[]
}

export function strategicWarSystem(date: Date, gameDay: number): StrategicWarResult {
  if (!isWartime()) return { resolved: [] }

  const resolved: string[] = []
  for (const ev of getWarEventsForDate(ucDateKey(date))) {
    if (isWarEventResolved(ev.id)) continue
    applyStrengthDelta(ev.strengthDelta, ev.frontShift)
    markWarEventResolved(ev.id)
    emitSim('war:event-resolved', { id: ev.id, gameDay })
    resolved.push(ev.id)
  }
  return { resolved }
}
