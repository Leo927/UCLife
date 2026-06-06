// Newsfeed (Phase 7.0.A) — the bar-TV channel + the player's consumed-headline
// journal. Lives in the sim layer because everything it needs (the koota world,
// news content data, the bar landmark, the clock + event bus, config) sits at
// or below sim — so the per-tick loop can drive it without an upward import.
//
// Runtime state is a zustand store so the journal HUD re-renders on consume;
// non-React callers (the per-tick system, the save handler, debug handles)
// drive it through the exported helpers.
//
// Availability is date-derived: "today's headlines" are simply the news.json5
// entries whose `date` matches the current UC date (topHeadlineForDate). No
// separate mutable "released" set — a pure function of the clock is equivalent
// to and simpler than marking entries on the day:rollover tick.
//
// Consume = co-location: when the player is within barTvRangePx of the bar
// counter and today's top headline isn't yet in their journal, it is recorded
// (passive, zero-cost) and a chime toast surfaces it. Missed days stay missed.
//
// Perf: O(1) per tick — one player lookup + one distance check + an O(1)
// date-keyed map read. Target N ~50 entries; trivially sub-budget on the
// per-tick path. No per-frame scan over entities of a class.

import { create } from 'zustand'
import type { World } from 'koota'
import { IsPlayer, Position } from '../ecs/traits'
import { tryGetLandmark } from '../data/landmarks'
import { getHeadlinesForDate, ucDateKey, getNewsEntry, type NewsEntry } from '../data/news'
import { gameDayNumber, useClock } from './clock'
import { emitSim } from './events'
import { isWartime } from './warState'
import { newsfeedConfig } from '../config'

export interface ConsumedHeadline {
  // news.json5 entry id.
  id: string
  // 1-based game day the player tuned in (for the journal timeline).
  gameDay: number
  // UC date key of the headline (so the journal can group/sort by date).
  dateKey: string
}

interface NewsfeedState {
  journal: ConsumedHeadline[]
  // Flipped only when the 7.0.B war-day force-toast hook fires. No caller in
  // 7.0.A — see fireWarDayToast() below.
  warDayToastFired: boolean
}

export const useNewsfeed = create<NewsfeedState>(() => ({
  journal: [],
  warDayToastFired: false,
}))

export function isHeadlineConsumed(id: string): boolean {
  return useNewsfeed.getState().journal.some((c) => c.id === id)
}

export function recordConsumedHeadline(entry: ConsumedHeadline): boolean {
  if (isHeadlineConsumed(entry.id)) return false
  useNewsfeed.setState((s) => ({ journal: [...s.journal, entry] }))
  return true
}

export function getNewsJournal(): readonly ConsumedHeadline[] {
  return useNewsfeed.getState().journal
}

export function wasWarDayToastFired(): boolean {
  return useNewsfeed.getState().warDayToastFired
}

// ── Bar-TV channel ───────────────────────────────────────────────────────

export type NewsfeedMode = 'prewar' | 'wartime'

// Phase 7.0.B newsfeed tone-shift. Pre-war the feed is plain priority order
// (the data layer pre-sorts by descending priority). Once wartime, war-tagged
// entries dominate the broadcast — the first war-tagged entry becomes the
// day's top headline, dropping to priority order only when no war entry is
// authored for the date. Pure over its inputs so it unit-tests without the
// clock or the global war flag.
export function rankTopHeadline(
  list: readonly NewsEntry[],
  wartime: boolean,
): NewsEntry | null {
  if (list.length === 0) return null
  if (!wartime) return list[0]
  return list.find((e) => e.tags.includes('war')) ?? list[0]
}

// Whether the feed is in wartime mode — the diegetic consequence of the
// 7.0.B transition flag flip.
export function newsfeedMode(): NewsfeedMode {
  return isWartime() ? 'wartime' : 'prewar'
}

// Today's top-of-broadcast headline for the given clock date, or null. Honors
// the wartime tone-shift.
export function topHeadlineToday(date: Date): NewsEntry | null {
  return rankTopHeadline(getHeadlinesForDate(ucDateKey(date)), isWartime())
}

export function newsfeedSystem(world: World, date: Date): void {
  const counter = tryGetLandmark('barCounter')
  if (!counter) return // scene has no bar — nothing to surface

  const top = rankTopHeadline(getHeadlinesForDate(ucDateKey(date)), isWartime())
  if (!top || isHeadlineConsumed(top.id)) return

  const player = world.queryFirst(IsPlayer, Position)
  if (!player) return
  const pos = player.get(Position)!
  if (Math.hypot(pos.x - counter.x, pos.y - counter.y) > newsfeedConfig.barTvRangePx) return

  recordConsumedHeadline({
    id: top.id,
    gameDay: gameDayNumber(date),
    dateKey: top.date,
  })
  // The chime + the headline scrolling above the counter, surfaced as a toast
  // (the deterministic, testable bar-TV signal).
  emitSim('toast', {
    textZh: `📺 酒吧电视 · ${top.headlineZh}`,
    durationMs: newsfeedConfig.chimeToastDurationMs,
  })
}

// War-day force-toast hook (authored inert in 7.0.A). The 7.0.B war-transition
// orchestrator calls this on UC 0079.01.03 to broadcast the Operation British
// headline to every screen in the city regardless of player location — the one
// time the missability rule breaks. No caller exists in 7.0.A; this mirrors the
// inert-now / live-later shape of ambitions `warPayoff` and diplomacy
// `postWarEscalation`. Idempotent: calling it after the first fire is a no-op
// (returns false), so the broadcast — and its toast — happen exactly once.
export function fireWarDayToast(): boolean {
  if (wasWarDayToastFired()) return false
  const entry = getNewsEntry(newsfeedConfig.warDayHeadlineId)
  if (!entry) return false
  useNewsfeed.setState({ warDayToastFired: true })
  // Force-toast regardless of location, and record it to the journal so the
  // war headline is permanently in the player's chronicle.
  recordConsumedHeadline({
    id: entry.id,
    gameDay: gameDayNumber(useClock.getState().gameDate),
    dateKey: entry.date,
  })
  emitSim('toast', {
    textZh: `🚨 ${entry.headlineZh}`,
    durationMs: newsfeedConfig.chimeToastDurationMs,
  })
  return true
}

// ── Persistence ──────────────────────────────────────────────────────────

export interface NewsfeedSnapshot {
  journal: ConsumedHeadline[]
  warDayToastFired: boolean
}

export function snapshotNewsfeed(): NewsfeedSnapshot {
  const s = useNewsfeed.getState()
  return { journal: s.journal.map((c) => ({ ...c })), warDayToastFired: s.warDayToastFired }
}

export function restoreNewsfeed(blob: NewsfeedSnapshot): void {
  useNewsfeed.setState({
    journal: (blob.journal ?? []).map((c) => ({ ...c })),
    warDayToastFired: Boolean(blob.warDayToastFired),
  })
}

export function resetNewsfeed(): void {
  useNewsfeed.setState({ journal: [], warDayToastFired: false })
}
