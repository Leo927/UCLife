// W4.1 — pure crew-duty resolution. Given whether the flagship is underway
// and the ship-local hour, decide where an on-roster crew member should be.
// Kept free of ECS + clock reads so it is unit-testable in isolation; the
// BT conditions in ai/agent.ts feed it the live (underway, hour) and route
// the crew to the matching station/mess/quarters action.
//
// Precedence: underway wins outright (man your station regardless of the
// clock); docked falls to the time-of-day routine; off-duty returns
// 'offDuty' so the BT branch fails and the crew drops through to the
// ordinary vital-driven drives.

import { crewConfig, type HourWindow } from '../config'
import { Ship, IsFlagshipMark } from '../ecs/traits'
import type { World } from 'koota'

export type CrewDuty = 'station' | 'mess' | 'quarters' | 'offDuty'

// [startHour, endHour): start inclusive, end exclusive. A window with
// start > end wraps past midnight (e.g. 22→6).
function hourInWindow(hour: number, w: HourWindow): boolean {
  if (w.startHour <= w.endHour) return hour >= w.startHour && hour < w.endHour
  return hour >= w.startHour || hour < w.endHour
}

export function resolveCrewDuty(underway: boolean, hour: number): CrewDuty {
  if (underway) return 'station'
  for (const w of crewConfig.duty.mealWindows) {
    if (hourInWindow(hour, w)) return 'mess'
  }
  if (hourInWindow(hour, crewConfig.duty.sleepWindow)) return 'quarters'
  return 'offDuty'
}

// The flagship is "underway" when it is not parked at a POI — i.e. flying
// the campaign sector. Crew man stations then. Reads the flagship Ship from
// the given world (the crew tick in the ship-interior world, which holds the
// flagship), so the resolver stays an ECS read with no systems import.
export function isFlagshipUnderway(world: World): boolean {
  const flagship = world.queryFirst(Ship, IsFlagshipMark)
  if (!flagship) return false
  return flagship.get(Ship)!.dockedAtPoiId === ''
}
