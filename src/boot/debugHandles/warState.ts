// Phase 7.0.B — war-transition debug handles for deterministic smoke tests.
// Reads the war-state surface and force-runs the transition + strategic-war
// systems at the current clock date (the day:rollover:settled path the prod
// loop drives), mirroring the faction-tier / newsfeed force-tick pattern.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { useClock, gameDayNumber } from '../../sim/clock'
import { snapshotWarState, isWartime } from '../../sim/warState'
import { newsfeedMode } from '../../sim/newsfeed'
import { ucDateKey } from '../../data/news'
import { availableAmbitions, wartimeAmbitionIds } from '../../character/ambitions'
import { warTransitionSystem } from '../../systems/warTransition'
import { strategicWarSystem } from '../../systems/strategicWar'

// Read the war surface: the IsWartime gate, the strategic-war model, resolved
// war-event ids, and the derived newsfeed mode.
registerDebugHandle('getWarState', () => {
  const s = snapshotWarState()
  return {
    currentDateKey: ucDateKey(useClock.getState().gameDate),
    isWartime: s.isWartime,
    transitionDay: s.transitionDay,
    factionStrength: { ...s.factionStrength },
    frontControl: { ...s.frontControl },
    resolvedEventIds: [...s.resolvedEventIds],
    warPayoffResolved: s.warPayoffResolved,
    newsfeedMode: newsfeedMode(),
  }
})

// Phase 7.0.D — the wartime-ambition unlock surface: whether the warPayoff
// routes resolved, the wartime-only ambition ids, and the ids currently
// offered in the picker (gated on isWartime()).
registerDebugHandle('getWarPayoffState', () => ({
  warPayoffResolved: snapshotWarState().warPayoffResolved,
  wartimeAmbitionIds: wartimeAmbitionIds(),
  offeredAmbitionIds: availableAmbitions(isWartime()).map((a) => a.id),
}))

// Run the transition orchestrator + strategic-war resolution once against the
// current clock date — the day:rollover:settled path. Day-scale war tests jump
// the clock (advanceGameDays / setGameDate) then force one tick here.
registerDebugHandle('forceWarTransitionTick', () => {
  const date = useClock.getState().gameDate
  const gameDay = gameDayNumber(date)
  const transition = warTransitionSystem(date, gameDay)
  const strategic = strategicWarSystem(date, gameDay)
  return {
    flipped: transition.flipped,
    isWartime: transition.isWartime,
    resolved: strategic.resolved,
  }
})
