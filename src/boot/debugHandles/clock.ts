// Test-only clock nudge. Sets the sim clock's hour-of-day (local, matching
// the setHours/getHours the whole sim uses) without stepping through the
// intervening hours — deterministic time-of-day for smokes that must land
// in a specific duty window (crew mess/quarters). advanceSimByGameMs reads
// gameDate.getTime() and adds, so a direct set persists across later steps.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { useClock } from '../../sim/clock'

registerDebugHandle('setGameHour', (hour: number) => {
  const d = new Date(useClock.getState().gameDate)
  d.setHours(hour, 0, 0, 0)
  useClock.setState({ gameDate: d })
  return d.getHours()
})
