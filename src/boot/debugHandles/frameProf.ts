// Frame-time profiler handles. Enable, read, and reset the per-stage
// frame-time decomposition (sim / snapshot / pixiUpdate / frame-interval)
// to attribute a "noticeable FPS drop" to the loop that owns it.
//
//   frameProf(true)   — start collecting (resets first); frameProf(false) stops
//   getFrameStats()   — { percentile, budgetMs, stages: { name → report } }
//   resetFrameStats() — zero the counters without disabling

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { frameStats, getFrameStats, resetFrameStats } from '../../sim/frameProfiler'

registerDebugHandle('frameProf', (on: boolean = true): boolean => {
  frameStats.enabled = on
  if (on) resetFrameStats()
  return frameStats.enabled
})

registerDebugHandle('getFrameStats', () => getFrameStats())

registerDebugHandle('resetFrameStats', () => { resetFrameStats() })
