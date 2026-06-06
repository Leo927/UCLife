// Phase 7.0.A — newsfeed debug handles for deterministic smoke tests.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { useClock } from '../../sim/clock'
import { world } from '../../ecs/world'
import {
  getNewsJournal, wasWarDayToastFired, fireWarDayToast, topHeadlineToday,
  newsfeedSystem,
} from '../../sim/newsfeed'
import { getNewsEntry, ucDateKey } from '../../data/news'
import { tryGetLandmark } from '../../data/landmarks'
import { worldConfig } from '../../config'

const TILE = worldConfig.tilePx

// Read the newsfeed surface: today's available top headline, the consumed
// journal (with resolved copy), the war-day-toast flag, and the bar counter
// tile (so a test can walk the player there).
registerDebugHandle('getNewsfeedState', () => {
  const date = useClock.getState().gameDate
  const top = topHeadlineToday(date)
  const counter = tryGetLandmark('barCounter')
  return {
    currentDateKey: ucDateKey(date),
    todayTopHeadlineId: top?.id ?? null,
    todayTopHeadline: top ? { id: top.id, date: top.date, headlineZh: top.headlineZh, tags: [...top.tags] } : null,
    journal: getNewsJournal().map((c) => {
      const entry = getNewsEntry(c.id)
      return {
        id: c.id,
        gameDay: c.gameDay,
        dateKey: c.dateKey,
        headlineZh: entry?.headlineZh ?? c.id,
        tags: entry ? [...entry.tags] : [],
      }
    }),
    warDayToastFired: wasWarDayToastFired(),
    barCounterTile: counter ? { x: Math.round(counter.x / TILE), y: Math.round(counter.y / TILE) } : null,
  }
})

// Run the per-tick newsfeed system once against the active-scene world at the
// current clock date — the consume path the prod loop drives every tick.
// Stepping real sim time across days is millions of 16ms ticks, so day-scale
// newsfeed tests jump the clock (advanceGameDays) then force one tick here,
// mirroring the diplomacy / faction-tier force-tick test pattern.
registerDebugHandle('forceNewsfeedTick', () => {
  newsfeedSystem(world, useClock.getState().gameDate)
  return true
})

// The inert war-day force-toast hook. Exposed so a test can confirm the entry
// point exists + works (7.0.B will be its real caller). Returns whether the
// headline was found + broadcast.
registerDebugHandle('fireWarDayToast', () => fireWarDayToast())
