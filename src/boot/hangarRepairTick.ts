// Phase 6.2.B — wires `hangarRepairSystem` to `day:rollover:settled`
// so the loop's day-rollup chain (dailyEconomics → housingPressure →
// recruitment → research) finishes before hangar throughput credits the
// day's repair. The subscription lives here rather than sim/loop.ts so
// the loop doesn't reach upward into systems/ (same arch boundary the
// research tick already obeys).
//
// Multi-scene scope: hangars exist in city scenes (vonBraunCity,
// granadaDrydock); ships sit in playerShipInterior. The system walks
// every SCENE_ID once per tick — it doesn't read getActiveSceneId().

import { onSim } from '../sim/events'
import { hangarRepairSystem } from '../systems/hangarRepair'

onSim('day:rollover:settled', ({ gameDay }) => {
  hangarRepairSystem(gameDay)
})
