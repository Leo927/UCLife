// Phase 6.2.B — wires `hangarRepairSystem` to `day:rollover:settled`
// so the loop's day-rollup chain (dailyEconomics → housingPressure →
// recruitment → research) finishes before hangar throughput credits the
// day's repair. The subscription lives here rather than sim/loop.ts so
// the loop doesn't reach upward into systems/ (same arch boundary the
// research tick already obeys).
//
// Multi-scene scope: hangars live in city scenes (the surface + orbital-
// drydock hangars both in vonBraunCity); ships sit in playerShipInterior.
// The system walks every SCENE_ID once per tick — it doesn't read
// getActiveSceneId().

import { onSim } from '../sim/events'
import { hangarRepairSystem } from '../systems/hangarRepair'
import { runOnShipRepair } from '../systems/onShipRepair'
import { getWorld } from '../ecs/world'
import { Ship } from '../ecs/traits'

onSim('day:rollover:settled', ({ gameDay }) => {
  hangarRepairSystem(gameDay)
  // W4.3 (completes W1.5) — forward-repair the MS riding aboard each hull
  // within its on-ship band. Depoted MS are handled by hangarRepairSystem
  // above; this only touches aboard MS (dockedAtPoiId === '').
  for (const ship of getWorld('playerShipInterior').query(Ship)) {
    runOnShipRepair(ship)
  }
})
