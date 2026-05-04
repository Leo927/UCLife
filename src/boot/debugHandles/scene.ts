// Scene + clock store handles, plus deterministic clock advance helpers
// used by ambitions / day-rollover tests so they don't have to wait for
// real RAF time to elapse.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { useScene } from '../../sim/scene'
import { useClock } from '../../sim/clock'

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

registerDebugHandle('enterSpace', () => {
  useScene.getState().setActive('spaceCampaign')
  return true
})
