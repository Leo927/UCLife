// Issue #70 — wires the brig-condition upkeep tick to the
// `day:rollover:settled` chain. Runs AFTER the physiology phase tick
// (bound on `day:rollover`) so the brig tick observes the Health.dead flag
// the shared physiology death gate set on a neglected prisoner, and frees
// the slot / applies the neglect rep penalty in the same day. Mirrors
// boot/fleetSupplyTick.ts so the sim loop doesn't reach upward into
// systems/.

import { onSim } from '../sim/events'
import { brigConditionTick } from '../systems/prisoners'

onSim('day:rollover:settled', ({ gameDay }) => {
  brigConditionTick(gameDay)
})
