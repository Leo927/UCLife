// W4.3 — crew role lookups keyed off the duty station a crew member is
// assigned (CrewStation.roomId, set by systems/crewAboard.ts). Lives in ecs/
// (not systems/) so the sim layer (sortieResupply.ts) can read the hangar
// boss's stats without an upward import — same rule fleetPool.ts follows.
//
// The ship's hangar boss is the crew member whose duty station is the hangar
// bay; the remaining hangar-stationed crew are the mechanic complement that
// services aboard MS. Resupply throughput reads both (completes W3.6).

import type { Entity } from 'koota'
import { getWorld } from './world'
import { Character, EmployedAsCrew, CrewStation, Attributes } from './traits'
import { getStat } from '../stats/sheet'
import { sortieConfig } from '../config'

const SHIP_SCENE_ID = 'playerShipInterior'

// The class-room id whose stationed crew member is the hangar boss.
export const HANGAR_BOSS_ROOM_ID = 'hangarBay'

export function isHangarBossCrew(e: Entity): boolean {
  return e.get(CrewStation)?.roomId === HANGAR_BOSS_ROOM_ID
}

// The hangar boss aboard the boarded flagship (the ship-interior world holds
// exactly the flagship's crew). First hangar-stationed crew member found.
export function findHangarBossAboard(): Entity | null {
  const shipWorld = getWorld(SHIP_SCENE_ID)
  for (const e of shipWorld.query(Character, EmployedAsCrew, CrewStation)) {
    if (isHangarBossCrew(e)) return e
  }
  return null
}

// Every hangar-stationed crew member of a given ship (boss + mechanic crew).
function hangarCrewFor(shipKey: string): Entity[] {
  const shipWorld = getWorld(SHIP_SCENE_ID)
  const out: Entity[] = []
  for (const e of shipWorld.query(Character, EmployedAsCrew, CrewStation)) {
    if (e.get(EmployedAsCrew)!.shipKey !== shipKey) continue
    if (isHangarBossCrew(e)) out.push(e)
  }
  return out
}

function workPerf(e: Entity): number {
  const a = e.get(Attributes)
  return a ? getStat(a.sheet, 'workPerfMul') : sortieConfig.defaultHangarBossPerformance
}

// Real hangar-crew stats for the sortie-resupply formula (completes W3.6):
// the boss's live workPerfMul plus the count of additional hangar-stationed
// mechanic crew. Falls back to the sortie.json5 config placeholders when no
// hangar boss is aboard the ship.
export function hangarResupplyStatsFor(
  shipKey: string,
): { bossPerf: number; mechanicCrewCount: number } {
  const crew = hangarCrewFor(shipKey)
  if (crew.length === 0) {
    return {
      bossPerf: sortieConfig.defaultHangarBossPerformance,
      mechanicCrewCount: sortieConfig.defaultMechanicCrewCount,
    }
  }
  return { bossPerf: workPerf(crew[0]), mechanicCrewCount: crew.length - 1 }
}
