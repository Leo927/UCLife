// Phase 6.4.D — shared council surface.
//
// The council scene (senior officers + colony administrators attending in
// person at the largest owned colony, arguing from their personas, the
// player resolving the room by speaking) is reused by both governance
// (6.4.C) and diplomacy (6.4.D). The primitives that are policy-agnostic —
// finding the player-faction / player entity, picking the seat-of-government
// colony, gathering attendees, and scoring an attendee's lean — live here so
// neither domain forks them. Each domain interprets the raw council score
// into its own stance semantics.
//
// Perf: O(senior officers at the colony) per call — typically < 10 entities.
// Councils are player-triggered (on-demand); no per-tick scan.

import type { Entity } from 'koota'
import {
  EntityKey, Attributes, Knows, IsPlayer, IsPlayerFaction, FactionSheet,
} from '../ecs/traits'
import { getStat } from '../stats/sheet'
import { getAllColonyRecords } from '../sim/colony'
import { getPrimaryDockScene } from '../data/pois'
import { getWorld, SCENE_IDS } from '../ecs/world'

// Stance on a proposed change. Direction-specific meaning is the domain's.
export type CouncilStance = 'support' | 'oppose' | 'neutral'

// How NPC traits influence their lean. Shared shape between governance and
// diplomacy stanceWeights config blocks.
export interface CouncilStanceWeights {
  intelligencePerLevel: number
  charismaPerLevel: number
  opinionPerPoint: number
}

export interface CouncilAttendee {
  entity: Entity
  roleZh: string
}

export function findPlayerFaction(): Entity | null {
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const e of w.query(FactionSheet)) {
      if (e.has(IsPlayerFaction)) return e
    }
  }
  return null
}

export function findPlayer(): Entity | null {
  for (const sceneId of SCENE_IDS) {
    const p = getWorld(sceneId).queryFirst(IsPlayer)
    if (p) return p
  }
  return null
}

// Largest player-owned colony by entity count in its scene (proxy for size).
export function findLargestPlayerColony(): string | null {
  const records = getAllColonyRecords()
  if (records.length === 0) return null
  let bestPoiId = records[0].poiId
  let bestCount = 0
  for (const rec of records) {
    const sceneId = getPrimaryDockScene(rec.poiId)
    if (!sceneId) continue
    let count = 0
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _e of getWorld(sceneId).query(EntityKey)) count++
    if (count > bestCount) { bestCount = count; bestPoiId = rec.poiId }
  }
  return bestPoiId
}

// Gather the colony's assigned officers (administrator, lead engineer,
// garrison commander) as council attendees, in role-priority order.
export function gatherAttendees(poiId: string): CouncilAttendee[] {
  const out: CouncilAttendee[] = []
  const seen = new Set<Entity>()
  const records = getAllColonyRecords()
  const record = records.find((r) => r.poiId === poiId)
  const sceneId = getPrimaryDockScene(poiId)
  if (!sceneId) return out
  const w = getWorld(sceneId)
  const byKey = new Map<string, Entity>()
  for (const e of w.query(EntityKey)) byKey.set(e.get(EntityKey)!.key, e)

  const addByKey = (key: string, roleZh: string) => {
    if (!key) return
    const e = byKey.get(key)
    if (!e || seen.has(e)) return
    seen.add(e)
    out.push({ entity: e, roleZh })
  }

  if (record) {
    addByKey(record.administratorKey, '管理官')
    addByKey(record.leadEngineerKey, '首席工程师')
    addByKey(record.garrisonCommanderKey, '守备指挥官')
  }
  return out
}

// Raw council lean on a ~0-100 scale. > 50 leans toward the more aggressive /
// expansionist option (higher taxation, signing a treaty); < 50 leans
// conservative. Domain code thresholds this into a CouncilStance. An NPC's
// opinion of the player nudges the score toward the player's position.
export function councilScore(
  entity: Entity,
  player: Entity | null,
  weights: CouncilStanceWeights,
): number {
  const attrs = entity.get(Attributes)
  if (!attrs) return 50
  const intel = getStat(attrs.sheet, 'intelligence')
  const charisma = getStat(attrs.sheet, 'charisma')
  let score = intel * weights.intelligencePerLevel + charisma * weights.charismaPerLevel
  if (player && entity.has(Knows(player))) {
    score += entity.get(Knows(player))!.opinion * weights.opinionPerPoint
  }
  return score
}
