// Phase 7.0.E.1 — runs the wartime refugee intake on day:rollover:settled
// (gated on isWartime + the configured cadence inside refugeeTick). Mirrors
// the loop's per-region replenishment iteration so refugees use the same
// region keys (and therefore the same home-region accounting) as immigrants.
// The subscription lives in boot/ so the loop and the system stay free of
// upward imports.

import { onSim } from '../sim/events'
import { useClock } from '../sim/clock'
import { getWorld, getActiveSceneId } from '../ecs/world'
import { getSceneConfig } from '../data/scenes'
import { refugeeTick } from '../systems/population'

onSim('day:rollover:settled', ({ gameDay }) => {
  const sceneId = getActiveSceneId()
  const scene = getSceneConfig(sceneId)
  if (scene.sceneType !== 'micro' || !scene.replenishments) return
  const regions = scene.replenishments.map((config, ri) => ({
    config,
    key: `${sceneId}#${ri}`,
  }))
  refugeeTick(getWorld(sceneId), useClock.getState().gameDate, gameDay, regions)
})
