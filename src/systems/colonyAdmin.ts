// Phase 6.3.D — administrative-load gate.
//
// Computes the player's personal administrative load across all owned colonies
// and their capacity (gated by the Leadership skill stand-in — see
// colonyConfig.adminLoad.leadershipSkillStandin). When the player is over
// capacity, player-administered colonies (those without an assigned
// administrator) receive a per-day stability penalty.
//
// Admin-load is recomputed on colony-roster change + the daily budget tick —
// O(player colonies), not per-frame. Trivially sub-budget for a handful of
// colonies.
//
// Leadership is deferred in the skill catalog (Design/characters/skills.md).
// This module reads an existing shipped skill as a stand-in; the swap is
// config-only when Leadership ships.

import { getAllColonyRecords } from '../sim/colony'
import { colonyConfig } from '../config/colony'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { IsPlayer } from '../ecs/traits'
import { getSkillXp, levelOf, type SkillId } from '../character/skills'

export interface AdminLoadStatus {
  totalLoad: number
  capacity: number
  overloadAmount: number
  isOverloaded: boolean
}

function playerLeadershipLevel(): number {
  const skillId = colonyConfig.adminLoad.leadershipSkillStandin as SkillId
  for (const sceneId of SCENE_IDS) {
    const p = getWorld(sceneId).queryFirst(IsPlayer)
    if (!p) continue
    return levelOf(getSkillXp(p, skillId))
  }
  return 0
}

export function computeAdminCapacity(): number {
  const cfg = colonyConfig.adminLoad
  const skillLevel = playerLeadershipLevel()
  return cfg.loadCapBase + Math.floor(skillLevel * cfg.loadCapPerSkillLevel)
}

export function computeAdminLoadStatus(): AdminLoadStatus {
  const cfg = colonyConfig.adminLoad
  const colonies = getAllColonyRecords()
  let totalLoad = 0
  for (const col of colonies) {
    const hasAdmin = col.administratorKey !== ''
    const colLoad = hasAdmin
      ? cfg.loadPerColony * (1 - cfg.adminLoadReductionFraction)
      : cfg.loadPerColony
    totalLoad += colLoad
  }
  const capacity = computeAdminCapacity()
  const overloadAmount = Math.max(0, totalLoad - capacity)
  return {
    totalLoad,
    capacity,
    overloadAmount,
    isOverloaded: overloadAmount > 0,
  }
}

