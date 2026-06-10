// Phase 5.5.6 — wires `facilityTierDowntimeSystem` to `day:rollover:settled`
// so the day-rollup chain (dailyEconomics → housingPressure → recruitment)
// finishes before the downtime countdown advances. A completing install
// applies its new tier values here, after settlement, so they're live for
// the *next* day's shifts and economics tick. The subscription lives in
// the boot layer rather than sim/loop.ts so the loop doesn't reach upward
// into systems/ (same pattern as researchTick.ts).
//
// Runs on every scene world: owned facilities outside the active scene
// still count their downtime down.

import { onSim } from '../sim/events'
import { facilityTierDowntimeSystem } from '../systems/facilityTiers'
import { getWorld, SCENE_IDS } from '../ecs/world'

onSim('day:rollover:settled', () => {
  for (const id of SCENE_IDS) {
    facilityTierDowntimeSystem(getWorld(id))
  }
})
