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
import { Character, Knows } from '../ecs/traits'
import {
  findPlayer,
  unhousedPlayerFactionMembers,
} from '../ecs/playerFaction'
import { economicsConfig } from '../config'
import { useClock } from '../sim/clock'
import { applyOpinionDelta } from './relations'

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

// Routed through the shared opinion-write path (applyOpinionDelta lazily
// seeds the edge), with the housing-specific floor applied by trimming the
// requested delta — pressure alone can't push a member below the floor.
// The per-day decrement sits below relations.ackThresholdAbs, so chronic
// shortfall drifts silently by design; a future high-weight housing event
// would queue its grievance for free.
function decayMemberOpinion(
  member: Entity,
  player: Entity,
  delta: number,
  floor: number,
): void {
  const cur = member.has(Knows(player)) ? member.get(Knows(player))!.opinion : 0
  const next = Math.max(floor, cur + delta)
  if (next === cur) return
  applyOpinionDelta(
    member, player, next - cur,
    { actorName: player.get(Character)?.name ?? '玩家', deedZh: '让我无处可住' },
    useClock.getState().gameDate.getTime(),
  )
}
