// Phase 5.5.3 daily housing-pressure rollup. Faction-of-one members
// without a bed claim in a player-owned residence lose opinion of the
// player at end-of-day. Per-day decrement is small; chronic shortfall
// accumulates.
//
// The system runs on the active scene world only — pre-creation
// player-faction members are a single-scene concept (they live where
// the player owns facilities). Cross-scene factions land with the
// formal MemberOf relation in 5.5.5.

import type { World, Entity } from 'koota'
import { Knows } from '../ecs/traits'
import {
  findPlayer,
  unhousedPlayerFactionMembers,
} from '../ecs/playerFaction'
import { economicsConfig } from '../config'
import { useClock } from '../sim/clock'

export interface HousingPressureResult {
  unhousedCount: number
  decayedCount: number
}

export function housingPressureSystem(world: World): HousingPressureResult {
  const result: HousingPressureResult = { unhousedCount: 0, decayedCount: 0 }
  const player = findPlayer(world)
  if (!player) return result

  const cfg = economicsConfig.housingPressure
  const decay = cfg.opinionDecayPerUnhousedDay
  const floor = cfg.minOpinionFromHousing
  if (decay === 0) return result

  const unhoused = unhousedPlayerFactionMembers(world, player)
  result.unhousedCount = unhoused.length

  for (const m of unhoused) {
    decayMemberOpinion(m, player, decay, floor)
    result.decayedCount += 1
  }
  return result
}

function decayMemberOpinion(
  member: Entity,
  player: Entity,
  delta: number,
  floor: number,
): void {
  if (!member.has(Knows(player))) {
    // Seed an edge so the drift surfaces in talk-verb tier-of(); zero
    // familiarity is fine — the relations system fills that in on
    // co-presence.
    member.add(Knows(player))
    member.set(Knows(player), {
      opinion: Math.max(floor, delta),
      familiarity: 0,
      lastSeenMs: useClock.getState().gameDate.getTime(),
      meetCount: 0,
    })
    return
  }
  const e = member.get(Knows(player))!
  const next = Math.max(floor, e.opinion + delta)
  if (next === e.opinion) return
  member.set(Knows(player), { ...e, opinion: next })
}
