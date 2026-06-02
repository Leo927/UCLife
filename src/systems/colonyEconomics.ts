// Phase 6.3.B — colony economics rollover.
// Runs once per game day alongside dailyEconomicsSystem after `day:rollover`.
//
// For each player-owned colony:
//   1. Walk Building entities in the colony's primary scene world.
//   2. Sum daily income for each typeId that has an entry in
//      colonyConfig.income.perFacilityType.
//   3. Credit the sum to the player faction fund (Faction.fund).
//   4. Recompute the stability score from QoL facilities present.
//   5. Top up any Hangar at the colony POI with hangarResupplyPerDay units.
//
// Colony income is a colony-registry-level calculation (not per-building
// Owner), so it runs regardless of whether individual buildings carry
// an Owner trait pointing to the player faction.
//
// Perf budget: O(colonies × buildings_per_colony_scene) once per game-day.
// A handful of colonies × a dozen facilities each is trivially sub-budget
// on the daily tick.

import type { World } from 'koota'
import { Building, Faction, Hangar, IsPlayerFaction } from '../ecs/traits'
import { getAllColonyRecords, getColonyEconomics, setColonyEconomics } from '../sim/colony'
import { colonyConfig } from '../config'
import { getPrimaryDockScene } from '../data/pois'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { emitSim } from '../sim/events'
import { useClock } from '../sim/clock'

export interface ColonyEconomicsResult {
  coloniesProcessed: number
  totalIncomeCredit: number
}

function nowMs(): number {
  return useClock.getState().gameDate.getTime()
}

// Apply income to the player faction in a specific world. Falls back to
// any world that has the IsPlayerFaction marker when the colony's own
// world has no IsPlayerFaction yet (e.g. uncreated faction case).
function creditFactionFundInWorld(w: World, delta: number): boolean {
  // Prefer the colony scene's own faction (keeps same-world consistency).
  let faction = w.queryFirst(IsPlayerFaction)
  if (!faction) {
    for (const id of SCENE_IDS) {
      const candidate = getWorld(id).queryFirst(IsPlayerFaction)
      if (candidate) { faction = candidate; break }
    }
  }
  if (!faction) return false
  const f = faction.get(Faction)
  if (!f) return false
  faction.set(Faction, { ...f, fund: f.fund + delta })
  return true
}

// Set of typeIds that qualify as QoL facilities for stability reckoning.
const QOL_TYPES = new Set(Object.keys(colonyConfig.stability.qolContribution))

export function colonyEconomicsSystem(gameDay: number): ColonyEconomicsResult {
  const result: ColonyEconomicsResult = { coloniesProcessed: 0, totalIncomeCredit: 0 }

  const colonies = getAllColonyRecords()
  if (colonies.length === 0) return result

  for (const { poiId } of colonies) {
    const econ = getColonyEconomics(poiId)
    if (!econ) continue

    // Same-day double-fire guard (mirrors dailyEconomicsSystem).
    if (econ.lastRolloverDay === gameDay) continue

    const sceneId = getPrimaryDockScene(poiId)
    if (!sceneId) continue

    const w = getWorld(sceneId)

    let incomeToday = 0
    let stabilityDelta = colonyConfig.stability.baseScore
    const qolPresent = new Set<string>()

    for (const bld of w.query(Building)) {
      const typeId = bld.get(Building)!.typeId
      if (typeId === '') continue

      const incomePerFacility = colonyConfig.income.perFacilityType[typeId] ?? 0
      incomeToday += incomePerFacility

      if (QOL_TYPES.has(typeId)) {
        qolPresent.add(typeId)
        stabilityDelta += colonyConfig.stability.qolContribution[typeId] ?? 0
      }
    }

    // Penalty for each missing QoL type.
    for (const typeId of QOL_TYPES) {
      if (!qolPresent.has(typeId)) {
        stabilityDelta += colonyConfig.stability.missingQolPenaltyPerType
      }
    }

    // Top up Hangar reserves at this colony scene.
    replenishColonyHangars(w)

    const newStability = econ.stabilityScore + stabilityDelta
    const newAccumulated = econ.accumulatedIncome + incomeToday

    setColonyEconomics(poiId, {
      ...econ,
      stabilityScore: newStability,
      accumulatedIncome: newAccumulated,
      lastRolloverDay: gameDay,
    })

    if (incomeToday > 0) {
      const credited = creditFactionFundInWorld(w, incomeToday)
      if (credited) result.totalIncomeCredit += incomeToday
    }

    if (newStability < 0) {
      emitSim('log', {
        textZh: `警告：${poiId} 殖民地稳定性不足（${newStability.toFixed(0)}）。`,
        atMs: nowMs(),
      })
    }

    result.coloniesProcessed += 1
  }

  return result
}

function replenishColonyHangars(w: World): void {
  const { supply, fuel } = colonyConfig.income.hangarResupplyPerDay
  for (const ent of w.query(Hangar)) {
    const h = ent.get(Hangar)!
    ent.set(Hangar, {
      ...h,
      supplyCurrent: Math.min(h.supplyMax, h.supplyCurrent + supply),
      fuelCurrent: Math.min(h.fuelMax, h.fuelCurrent + fuel),
    })
  }
}

// Resupply a player ship from a colony's Hangar reserves at no markup.
// Returns the units transferred and the cost charged (markupFactor * base price).
// Used by the debug handle + future colony depot dialogue.
export interface ColonyResupplyResult {
  ok: boolean
  unitsTransferred: number
  creditCharged: number
  reason?: string
}

export function colonyResupplyFromHangar(
  colonyPoiId: string,
  kind: 'supply' | 'fuel',
  qty: number,
): ColonyResupplyResult {
  const sceneId = getPrimaryDockScene(colonyPoiId)
  if (!sceneId) return { ok: false, unitsTransferred: 0, creditCharged: 0, reason: 'no scene for poi' }

  const w = getWorld(sceneId)
  for (const ent of w.query(Hangar)) {
    const h = ent.get(Hangar)!
    if (kind === 'supply') {
      const available = Math.min(qty, h.supplyCurrent)
      if (available <= 0) return { ok: false, unitsTransferred: 0, creditCharged: 0, reason: 'no supply stock' }
      ent.set(Hangar, { ...h, supplyCurrent: h.supplyCurrent - available })
      const cost = Math.floor(available * colonyConfig.resupply.markupFactor)
      return { ok: true, unitsTransferred: available, creditCharged: cost }
    } else {
      const available = Math.min(qty, h.fuelCurrent)
      if (available <= 0) return { ok: false, unitsTransferred: 0, creditCharged: 0, reason: 'no fuel stock' }
      ent.set(Hangar, { ...h, fuelCurrent: h.fuelCurrent - available })
      const cost = Math.floor(available * colonyConfig.resupply.markupFactor)
      return { ok: true, unitsTransferred: available, creditCharged: cost }
    }
  }
  return { ok: false, unitsTransferred: 0, creditCharged: 0, reason: 'no hangar at colony' }
}
