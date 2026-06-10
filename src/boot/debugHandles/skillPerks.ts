// Issue #142 — skill-perk debug handles for deterministic smoke tests:
// inspect the milestone/pick/respec state, commit a pick without the UI,
// and query unlock flags.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { getWorld, getActiveSceneId } from '../../ecs/world'
import { IsPlayer } from '../../ecs/traits'
import {
  pendingTiers, pickSkillPerk, allPicks, hasUnlock, respecCost, respecCountOf,
} from '../../character/skillPerks'
import type { SkillId } from '../../character/skills'
import type { Entity } from 'koota'

function findPlayer(): Entity | null {
  return getWorld(getActiveSceneId()).queryFirst(IsPlayer) ?? null
}

registerDebugHandle('getSkillPerkState', () => {
  const player = findPlayer()
  if (!player) return null
  const respecs = respecCountOf(player)
  return {
    picks: allPicks(player),
    pending: pendingTiers(player).map((p) => ({ skill: p.skill, tier: p.tier })),
    respecCount: respecs,
    nextRespecCost: respecCost(respecs),
  }
})

registerDebugHandle('pickSkillPerk', (skill: SkillId, tier: number, optionId: string) => {
  const player = findPlayer()
  if (!player) return { ok: false, reason: 'no player in active scene' }
  return { ok: pickSkillPerk(player, skill, tier, optionId) }
})

registerDebugHandle('hasUnlock', (flag: string) => {
  const player = findPlayer()
  return player ? hasUnlock(player, flag) : false
})
