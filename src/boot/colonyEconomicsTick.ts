// Phase 6.3.B — wires `colonyEconomicsSystem` to `day:rollover:settled` so
// the loop's day-rollup chain (dailyEconomics → housingPressure →
// recruitment) finishes before colony income + stability accrue. The
// subscription lives in the boot layer rather than sim/loop.ts so the
// loop doesn't reach upward into systems/ (mirrors boot/researchTick.ts).
//
// Colony-registry-level, not per-world: colonyEconomicsSystem walks the
// player-colony registry and resolves each colony's primary dock scene
// internally, so it needs no world argument.

import { onSim } from '../sim/events'
import { colonyEconomicsSystem } from '../systems/colonyEconomics'

onSim('day:rollover:settled', ({ gameDay }) => {
  colonyEconomicsSystem(gameDay)
})
