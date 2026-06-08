// Phase 7.0.E.1 — refugee-intake debug handles for deterministic smoke tests.
// Force-runs the intake roll (the day:rollover:settled path the prod loop
// drives on cadence) over the active scene's replenishment regions, and reads
// the persisted refugee bookkeeping.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { useClock } from '../../sim/clock'
import { getWorld, getActiveSceneId } from '../../ecs/world'
import { getSceneConfig } from '../../data/scenes'
import { refugeeSpawnRoll, getRefugeeBookkeeping } from '../../systems/population'

// Run one refugee intake roll at the current clock date over the active scene's
// regions, bypassing the wartime + cadence gates (the day-scale cadence would
// need many days of advance otherwise). Returns per-region spawn detail.
registerDebugHandle('forceRefugeeSpawnRoll', () => {
  const sceneId = getActiveSceneId()
  const scene = getSceneConfig(sceneId)
  if (scene.sceneType !== 'micro' || !scene.replenishments) {
    return { totalSpawned: 0, regions: [] }
  }
  const regions = scene.replenishments.map((config, ri) => ({
    config,
    key: `${sceneId}#${ri}`,
  }))
  return refugeeSpawnRoll(getWorld(sceneId), useClock.getState().gameDate, regions)
})

registerDebugHandle('getRefugeeState', () => ({ ...getRefugeeBookkeeping() }))
