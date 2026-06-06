// Scene + clock store handles, plus deterministic clock advance helpers
// used by ambitions / day-rollover tests so they don't have to wait for
// real RAF time to elapse.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { useScene } from '../../sim/scene'
import { useClock } from '../../sim/clock'
import { ucDateKeyOrdinal } from '../../data/news'

registerDebugHandle('useScene', useScene)
registerDebugHandle('useClock', useClock)

registerDebugHandle('advanceGameMinutes', (minutes: number) => {
  useClock.getState().advance(minutes)
  return true
})

registerDebugHandle('advanceGameDays', (days: number) => {
  useClock.getState().advance(days * 24 * 60)
  return true
})

// Jump the clock directly to a canonical UC date ("UC YYYY.MM.DD") at noon —
// deterministic single set, no RAF stepping. Used by date-gated tests (the
// 7.0.B war trigger) so they assert against an exact date without hand-
// computing day deltas from the campaign start.
registerDebugHandle('setGameDate', (dateKey: string) => {
  const ord = ucDateKeyOrdinal(dateKey) // validates format; throws on typo
  const y = Math.floor(ord / 10000)
  const m = Math.floor((ord % 10000) / 100)
  const d = ord % 100
  const next = new Date(useClock.getState().gameDate)
  next.setFullYear(y, m - 1, d)
  next.setHours(12, 0, 0, 0)
  useClock.setState({ gameDate: next })
  return true
})

registerDebugHandle('enterSpace', () => {
  useScene.getState().setActive('spaceCampaign')
  return true
})
