// Phase 6.3.E — colony threat system: pirate raids + stability collapse.
//
// Runs once per game day on `day:rollover:settled` after economics + construction
// settle, so stability scores are up to date before the collapse check.
//
// For each player-owned colony the system:
//   1. Computes garrison strength from barracks buildings + garrison-commander skill.
//   2. Rolls a seeded random against the raid-chance formula; applies pirate-attention
//      multiplier when the build-path charter was skipped.
//   3. If a raid spawns:
//      - garrison >= autoResolveGarrisonThreshold → auto-resolve, emit log.
//      - else → emit warning log (player must defend manually).
//   4. Sets the raid cooldown on the colony threat state.
//   5. Checks whether the stability score is below stabilityFloor:
//      - First day below floor → start collapse grace period, emit warning.
//      - Already in grace period + grace expired → forfeit ownership, emit log.
//      - Stability recovered → clear grace period.
//
// Perf: O(player colonies) × O(buildings_per_colony_scene) once per game-day.
// A handful of colonies × a dozen facilities each is trivially sub-budget.

import type { World } from 'koota'
import { Building, Character, EntityKey } from '../ecs/traits'
import {
  getAllColonyRecords,
  getColonyEconomics,
  getColonyThreatState,
  setColonyThreatState,
  getBuildPathState,
  forfeitColony,
  type ColonyRecord,
} from '../sim/colony'
import { colonyConfig } from '../config/colony'
import { getSimRng } from '../sim/rng'
import { getPrimaryDockScene } from '../data/pois'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { emitSim } from '../sim/events'
import { useClock } from '../sim/clock'
import { getSkillXp, levelOf, type SkillId } from '../character/skills'

export interface ColonyThreatsResult {
  coloniesProcessed: number
  raidsSpawned: number
  autoResolved: number
  collapseWarningsFired: number
  coloniesForfeited: number
}

function nowMs(): number {
  return useClock.getState().gameDate.getTime()
}

function countBarracks(w: World): number {
  let count = 0
  for (const bld of w.query(Building)) {
    if (bld.get(Building)!.typeId === 'colonyBarracks') count += 1
  }
  return count
}

function garrisonCommanderSkillLevel(commanderKey: string): number {
  if (!commanderKey) return 0
  const skillId = colonyConfig.threats.garrisonCommanderSkillStandin as SkillId
  for (const sceneId of SCENE_IDS) {
    for (const ent of getWorld(sceneId).query(Character, EntityKey)) {
      if (ent.get(EntityKey)!.key === commanderKey) {
        return levelOf(getSkillXp(ent, skillId))
      }
    }
  }
  return 0
}

export function computeGarrisonStrength(w: World, col: ColonyRecord): number {
  const cfg = colonyConfig.threats
  const barracks = countBarracks(w)
  const commanderLevel = garrisonCommanderSkillLevel(col.garrisonCommanderKey)
  return (
    barracks * cfg.garrisonStrengthPerBarracks +
    commanderLevel * cfg.garrisonStrengthPerCommanderSkillLevel
  )
}

function computeRaidChance(accumulatedIncome: number, garrisonStrength: number, pirateAttention: boolean): number {
  const cfg = colonyConfig.threats
  const raw =
    cfg.baseRaidChancePerDay +
    cfg.raidWealthFactor * accumulatedIncome -
    cfg.raidGarrisonFactor * garrisonStrength
  const clamped = Math.max(0, Math.min(cfg.maxRaidChancePerDay, raw))
  return pirateAttention ? Math.min(cfg.maxRaidChancePerDay, clamped * cfg.pirateAttentionMultiplier) : clamped
}

export function colonyThreatsSystem(gameDay: number): ColonyThreatsResult {
  const result: ColonyThreatsResult = {
    coloniesProcessed: 0,
    raidsSpawned: 0,
    autoResolved: 0,
    collapseWarningsFired: 0,
    coloniesForfeited: 0,
  }

  const colonies = getAllColonyRecords()
  if (colonies.length === 0) return result

  const cfg = colonyConfig.threats
  const rng = getSimRng()
  const { pirateAttentionFlag } = getBuildPathState()

  const forfeited: string[] = []

  for (const col of colonies) {
    const { poiId } = col
    const econ = getColonyEconomics(poiId)
    if (!econ) continue

    const sceneId = getPrimaryDockScene(poiId)
    if (!sceneId) continue

    const w = getWorld(sceneId)
    const threat = getColonyThreatState(poiId)
    let { lastRaidAttemptDay, collapseGraceStartDay } = threat

    // ── 1. Raid roll ──────────────────────────────────────────────────────────

    const cooldownElapsed = lastRaidAttemptDay === 0 || gameDay - lastRaidAttemptDay >= cfg.raidCooldownDays
    if (cooldownElapsed) {
      const garrisonStrength = computeGarrisonStrength(w, col)
      const raidChance = computeRaidChance(econ.accumulatedIncome, garrisonStrength, pirateAttentionFlag)
      const roll = rng.next()

      if (roll < raidChance) {
        lastRaidAttemptDay = gameDay
        result.raidsSpawned += 1

        if (garrisonStrength >= cfg.autoResolveGarrisonThreshold) {
          result.autoResolved += 1
          emitSim('log', {
            textZh: `${poiId} 殖民地驻军击退了海盗袭击（驻防强度 ${garrisonStrength.toFixed(1)}）。`,
            atMs: nowMs(),
          })
          emitSim('toast', {
            textZh: `${poiId} 驻军自动击退袭击`,
            durationMs: 4000,
          })
        } else {
          emitSim('log', {
            textZh: `警告：${poiId} 殖民地正遭受海盗袭击！驻防薄弱（${garrisonStrength.toFixed(1)}），需要亲自防御。`,
            atMs: nowMs(),
          })
          emitSim('toast', {
            textZh: `紧急：${poiId} 遭到海盗袭击，驻防不足！`,
            durationMs: 6000,
          })
        }
      }
    }

    // ── 2. Stability collapse grace check ────────────────────────────────────

    const stability = econ.stabilityScore
    if (stability < cfg.stabilityFloor) {
      if (collapseGraceStartDay === 0) {
        collapseGraceStartDay = gameDay
        result.collapseWarningsFired += 1
        emitSim('log', {
          textZh: `警告：${poiId} 殖民地稳定性严重崩溃（${stability.toFixed(0)}），将在 ${cfg.collapseGraceDays} 天后失去所有权！`,
          atMs: nowMs(),
        })
        emitSim('toast', {
          textZh: `${poiId} 稳定性崩溃倒计时（${cfg.collapseGraceDays} 天）`,
          durationMs: 6000,
        })
      } else if (gameDay - collapseGraceStartDay >= cfg.collapseGraceDays) {
        emitSim('log', {
          textZh: `${poiId} 殖民地稳定性持续崩溃，殖民者暴动，已失去所有权！`,
          atMs: nowMs(),
        })
        emitSim('toast', {
          textZh: `${poiId} 殖民地暴动，已失去所有权！`,
          durationMs: 8000,
        })
        forfeited.push(poiId)
        result.coloniesForfeited += 1
        result.coloniesProcessed += 1
        continue
      }
    } else if (collapseGraceStartDay !== 0) {
      collapseGraceStartDay = 0
    }

    setColonyThreatState(poiId, { lastRaidAttemptDay, collapseGraceStartDay })
    result.coloniesProcessed += 1
  }

  for (const poiId of forfeited) {
    forfeitColony(poiId)
  }

  return result
}
