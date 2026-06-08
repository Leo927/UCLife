// Phase 7.0.E.2 — civilian-churn debug handles for deterministic smoke tests.
// Force-runs the churn roll (the day:rollover:settled path the prod loop drives
// on cadence) and reads the churn bookkeeping.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { useClock, gameDayNumber } from '../../sim/clock'
import { snapshotCivilianChurn } from '../../sim/civilianChurnState'
import { civilianChurnRoll } from '../../systems/civilianChurn'

registerDebugHandle('getCivilianChurnState', () => ({ ...snapshotCivilianChurn() }))

// Run the churn roll once at the current clock date (bypassing the cadence
// gate — the day-scale cadence would need many days of advance otherwise).
registerDebugHandle('forceCivilianChurnRoll', () => {
  const date = useClock.getState().gameDate
  return civilianChurnRoll(gameDayNumber(date), date.getTime())
})
