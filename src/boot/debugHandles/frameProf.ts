// Frame-profiler debug handles (issue #154 — NPC BT per-frame cost).
//
// Usage:
//   __uclife__.frameProf(true)
//   // walk around the populated city for a few seconds
//   __uclife__.getFrameStats()   // → {mean, max, p99, calls} per stage
//   __uclife__.resetFrameStats() // clear sample buffer and restart
//   __uclife__.frameProf(false)  // stop

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { setFrameProfEnabled, getFrameStats, resetFrameStats, type FrameStats } from '../../sim/frameProfiler'

registerDebugHandle('frameProf', (enabled: boolean): void => {
  setFrameProfEnabled(enabled)
})

registerDebugHandle('getFrameStats', (): Record<string, FrameStats> => {
  return getFrameStats()
})

registerDebugHandle('resetFrameStats', (): void => {
  resetFrameStats()
})
