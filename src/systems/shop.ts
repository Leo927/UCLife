// "Open" = at least one NPC is in 'working' Action at the counter.

import type { World } from 'koota'
import { Character, Position, Action, Health } from '../ecs/traits'
import { getLandmark } from '../data/landmarks'
import { worldConfig } from '../config'
import { useClock } from '../sim/clock'

const COUNTER_RANGE = worldConfig.ranges.counterStaffed

function isCounterStaffed(world: World, counter: { x: number; y: number }): boolean {
  for (const npc of world.query(Character, Position, Action)) {
    const h = npc.get(Health)
    if (h?.dead) continue
    const a = npc.get(Action)!
    if (a.kind !== 'working') continue
    const p = npc.get(Position)!
    if (Math.hypot(p.x - counter.x, p.y - counter.y) < COUNTER_RANGE) return true
  }
  return false
}

// Per-game-minute memo. Action transitions fire on tick boundaries, so a
// tick-grained cache is exact, not approximate.
let shopGameMs = -1
let shopOpen = false
let barGameMs = -1
let barOpen = false

export function isShopOpen(world: World): boolean {
  const nowMs = useClock.getState().gameDate.getTime()
  if (shopGameMs === nowMs) return shopOpen
  shopOpen = isCounterStaffed(world, getLandmark('shopCounter'))
  shopGameMs = nowMs
  return shopOpen
}

export function isBarOpen(world: World): boolean {
  const nowMs = useClock.getState().gameDate.getTime()
  if (barGameMs === nowMs) return barOpen
  barOpen = isCounterStaffed(world, getLandmark('barCounter'))
  barGameMs = nowMs
  return barOpen
}
