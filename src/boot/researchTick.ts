// Phase 5.5.6 — wires `researchSystem` to `day:rollover:settled` so the
// loop's day-rollup chain (dailyEconomics → housingPressure →
// recruitment) finishes before research credits the day's progress. The
// subscription lives in the boot layer rather than sim/loop.ts so the
// loop doesn't reach upward into systems/.
//
// Single-scene scope: research labs sit on the active scene world (same
// as housingPressure / recruitment). Cross-scene research lands when the
// player-faction migration in 5.5.5 introduces explicit MemberOf edges.

import { onSim } from '../sim/events'
import { researchSystem } from '../systems/research'
import { getWorld, getActiveSceneId } from '../ecs/world'

onSim('day:rollover:settled', ({ gameDay }) => {
  const world = getWorld(getActiveSceneId())
  researchSystem(world, gameDay)
})
