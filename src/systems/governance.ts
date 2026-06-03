// Phase 6.4.C — governance council system.
// Runs on-demand (player-triggered); not a per-tick scan.
// Perf: O(senior officers at the colony) per call — typically < 10 entities.

import type { Entity } from 'koota'
import {
  EntityKey, Character, Attributes, Knows, CouncilDissentMood,
  IsPlayerFaction, IsPlayer, FactionSheet,
} from '../ecs/traits'
import { addFactionEffect, removeFactionEffect } from '../ecs/factionEffects'
import { getStat } from '../stats/sheet'
import { getAllColonyRecords } from '../sim/colony'
import { getPrimaryDockScene } from '../data/pois'
import { governanceConfig } from '../config/governance'
import type { PolicyKind } from '../config/governance'
import type { FactionStatId } from '../stats/factionSchema'
import type { Effect } from '../stats/effects'
import {
  setActivePolicy, getActivePolicy, setDissentRecord, clearDissentRecord,
  getAllDissentRecords,
} from '../sim/governance'
import { getWorld, SCENE_IDS } from '../ecs/world'

// Stance on a policy change direction.
export type CouncilStance = 'support' | 'oppose' | 'neutral'

export interface AttendeeView {
  npcKey: string
  nameZh: string
  roleZh: string
  stance: CouncilStance
  argumentZh: string
}

export interface CouncilSession {
  poiId: string
  policyKind: PolicyKind
  currentValue: string
  attendees: AttendeeView[]
}

function policyEffectId(kind: PolicyKind): string {
  return `policy:${kind}`
}

function findPlayerFaction(): Entity | null {
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const e of w.query(FactionSheet)) {
      if (e.has(IsPlayerFaction)) return e
    }
  }
  return null
}

function findPlayer(): Entity | null {
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

function gatherAttendees(poiId: string): Array<{ entity: Entity; roleZh: string }> {
  const out: Array<{ entity: Entity; roleZh: string }> = []
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

function computeStance(
  entity: Entity,
  policyKind: PolicyKind,
  proposedValue: string,
  player: Entity | null,
): CouncilStance {
  const attrs = entity.get(Attributes)
  if (!attrs) return 'neutral'
  const intel = getStat(attrs.sheet, 'intelligence')
  const charisma = getStat(attrs.sheet, 'charisma')
  const w = governanceConfig.stanceWeights
  let score = intel * w.intelligencePerLevel + charisma * w.charismaPerLevel
  if (player && entity.has(Knows(player))) {
    score += (entity.get(Knows(player))!.opinion) * w.opinionPerPoint
  }
  const cfg = governanceConfig.policies[policyKind]
  const currentValue = getActivePolicy(policyKind)?.value ?? String(cfg.defaultValue)
  const opts = cfg.options.map(String)
  const direction = opts.indexOf(proposedValue) - opts.indexOf(currentValue)
  if (Math.abs(score - 50) < 5) return 'neutral'
  const bias = score > 50 ? 1 : -1
  if (direction === 0 || bias === Math.sign(direction)) return 'support'
  return 'oppose'
}

const SUPPORT_ARGS: Record<PolicyKind, string> = {
  taxation: '这个税率对我们的扩张计划有利。',
  alignment: '这个立场能巩固我们的政治地位。',
  tradePriority: '调整贸易重心符合当前战略需要。',
}
const OPPOSE_ARGS: Record<PolicyKind, string> = {
  taxation: '这会加剧民心离散，我建议慎重。',
  alignment: '这个立场可能给我们带来不必要的麻烦。',
  tradePriority: '现在这么做时机不对，风险太高。',
}
const NEUTRAL_ARGS: Record<PolicyKind, string> = {
  taxation: '情况尚不明朗，听从指挥官安排。',
  alignment: '保持中立观望即可。',
  tradePriority: '均衡发展是最稳妥的选择。',
}

export function callCouncil(poiId: string, policyKind: PolicyKind): CouncilSession | null {
  if (!getAllColonyRecords().some((r) => r.poiId === poiId)) return null
  const player = findPlayer()
  const rawAttendees = gatherAttendees(poiId)
  if (rawAttendees.length === 0) return null
  const cfg = governanceConfig.policies[policyKind]
  const currentValue = getActivePolicy(policyKind)?.value ?? String(cfg.defaultValue)
  const opts = cfg.options.map(String)
  const curIdx = opts.indexOf(currentValue)
  const proposedValue = curIdx < opts.length - 1 ? opts[curIdx + 1] : opts[curIdx]
  const attendees: AttendeeView[] = rawAttendees.map(({ entity, roleZh }) => {
    const stance = computeStance(entity, policyKind, proposedValue, player)
    const nameZh = entity.get(Character)?.name ?? entity.get(EntityKey)?.key ?? '?'
    const argumentZh =
      stance === 'support' ? SUPPORT_ARGS[policyKind]
        : stance === 'oppose' ? OPPOSE_ARGS[policyKind]
          : NEUTRAL_ARGS[policyKind]
    return { npcKey: entity.get(EntityKey)?.key ?? '', nameZh, roleZh, stance, argumentZh }
  })
  return { poiId, policyKind, currentValue, attendees }
}

export function resolveCouncil(
  session: CouncilSession,
  newValue: string,
  gameDay: number,
): void {
  const pf = findPlayerFaction()
  if (!pf) return
  const effectId = policyEffectId(session.policyKind)
  removeFactionEffect(pf, effectId)
  const policyCfg = governanceConfig.policies[session.policyKind]
  const effectValues = policyCfg.effects[newValue]
  if (effectValues) {
    const modifiers: Array<{ statId: FactionStatId; type: 'flat'; value: number }> = []
    for (const [statId, value] of Object.entries(effectValues)) {
      if (typeof value === 'number' && value !== 0) {
        modifiers.push({ statId: statId as FactionStatId, type: 'flat', value })
      }
    }
    if (modifiers.length > 0) {
      const effect: Effect<FactionStatId> = {
        id: effectId,
        originId: `governance:${session.policyKind}`,
        family: 'research',
        modifiers,
        nameZh: `${policyCfg.labelZh}政策`,
      }
      addFactionEffect(pf, effect)
    }
  }
  const sceneId = getPrimaryDockScene(session.poiId)
  const player = findPlayer()
  const expiresDay = gameDay + governanceConfig.dissentDurationDays

  // Compute dissent BEFORE updating the registry so that computeStance
  // still reads the OLD currentValue as the reference baseline.
  const dissentTargets: Array<{ entity: Entity; npcKey: string; stance: CouncilStance }> = []
  if (sceneId) {
    const w = getWorld(sceneId)
    const byKey = new Map<string, Entity>()
    for (const e of w.query(EntityKey)) byKey.set(e.get(EntityKey)!.key, e)
    for (const attendee of session.attendees) {
      const entity = byKey.get(attendee.npcKey)
      if (!entity) continue
      const stance = computeStance(entity, session.policyKind, newValue, player)
      dissentTargets.push({ entity, npcKey: attendee.npcKey, stance })
    }
  }

  // Now commit the new policy to the registry.
  setActivePolicy({ kind: session.policyKind, value: newValue, decidedDay: gameDay })

  // Stamp or clear dissent on each attendee.
  for (const { entity, npcKey, stance } of dissentTargets) {
    if (stance === 'oppose') {
      entity.set(CouncilDissentMood, {
        moodDelta: governanceConfig.dissentMoodDelta,
        expiresDay,
        policyKind: session.policyKind,
      })
      setDissentRecord({ npcKey, policyKind: session.policyKind, expiresDay })
    } else {
      if (entity.has(CouncilDissentMood)) entity.remove(CouncilDissentMood)
      clearDissentRecord(npcKey)
    }
  }
}

// Call on day:rollover to expire dissent records whose expiresDay has passed.
export function governanceDissentDecayTick(gameDay: number): void {
  for (const record of getAllDissentRecords()) {
    if (gameDay <= record.expiresDay) continue
    clearDissentRecord(record.npcKey)
    for (const sceneId of SCENE_IDS) {
      const w = getWorld(sceneId)
      for (const e of w.query(EntityKey, CouncilDissentMood)) {
        if (e.get(EntityKey)!.key === record.npcKey) {
          e.remove(CouncilDissentMood)
          break
        }
      }
    }
  }
}
