// Ground-renderer profiler handles. groundStats tallies per-layer VISIBLE node
// counts + per-frame update ms (the renderer reconciles + redraws visible
// Graphics each frame). enableGroundStats(true) resets + starts; groundStats()
// reads. Lets the perf harness see how the per-frame render cost scales with
// on-screen geometry density (sparse plain vs dense procgen city).

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { groundStats, resetGroundStats } from '../../render/ground/PixiGroundRenderer'

registerDebugHandle('enableGroundStats', (enabled: boolean): void => {
  groundStats.enabled = enabled
  if (enabled) resetGroundStats()
})

registerDebugHandle('groundStats', () => ({
  frames: groundStats.frames,
  avgUpdateMs: groundStats.frames > 0 ? groundStats.totalUpdateMs / groundStats.frames : 0,
  staticRedraws: groundStats.staticRedraws,
  roadNodes: groundStats.roadNodes,
  buildingNodes: groundStats.buildingNodes,
  wallNodes: groundStats.wallNodes,
  doorNodes: groundStats.doorNodes,
  bedNodes: groundStats.bedNodes,
  barSeatNodes: groundStats.barSeatNodes,
  interactableNodes: groundStats.interactableNodes,
  npcNodes: groundStats.npcNodes,
}))
