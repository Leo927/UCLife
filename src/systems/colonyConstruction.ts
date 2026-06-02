// Phase 6.3.C — colony construction rollover.
// Runs once per game day alongside colonyEconomicsSystem after
// `day:rollover:settled`. For each colony with in-progress construction
// jobs:
//   1. Decrement daysRemaining for each in-progress job.
//   2. When daysRemaining reaches 0, mark completed and spawn a minimal
//      Building entity in the colony's primary dock scene world.
//   3. Apply a seeded-RNG interrupt roll once per colony that has active
//      work — fires `hyperspeed:break` + sets speed to 0.
//
// Perf budget: O(colonies × in-progress jobs) once per game-day.
// A handful of colonies × a few concurrent builds is trivially sub-budget.

import type { World } from 'koota'
import { Building, EntityKey, Facility, Owner } from '../ecs/traits'
import {
  getAllColonyRecords,
  getConstructionJobs,
  updateConstructionJob,
  type ConstructionJob,
} from '../sim/colony'
import { colonyConfig } from '../config'
import { getPrimaryDockScene } from '../data/pois'
import { getWorld } from '../ecs/world'
import { getBuildingType, isFixedSize } from '../data/buildingTypes'
import { getSimRng } from '../sim/rng'
import { emitSim } from '../sim/events'
import { useClock } from '../sim/clock'

export interface ColonyConstructionResult {
  coloniesProcessed: number
  jobsAdvanced: number
  jobsCompleted: number
  interruptsFired: number
}

const INTERRUPT_REASONS = [
  '工人受伤中断施工',
  '派系视察员突击检查',
  '补给船货物被争议扣押',
] as const

function nowMs(): number {
  return useClock.getState().gameDate.getTime()
}

function spawnCompletedFacilityInWorld(w: World, facilityType: string): void {
  const btype = getBuildingType(facilityType)
  const size = isFixedSize(btype.size)
    ? btype.size
    : { w: btype.size.maxW, h: btype.size.maxH }
  const key = `construction-complete-${facilityType}-${Date.now()}`
  w.spawn(
    Building({ x: 0, y: 0, w: size.w, h: size.h, label: btype.labelZh, typeId: facilityType }),
    EntityKey({ key }),
    Facility({
      revenueAcc: 0,
      salariesAcc: 0,
      insolventDays: 0,
      lastRolloverDay: 0,
      closedSinceDay: 0,
      closedReason: null,
    }),
    Owner({ kind: 'state', entity: null }),
  )
}

export function colonyConstructionSystem(_gameDay: number): ColonyConstructionResult {
  const result: ColonyConstructionResult = {
    coloniesProcessed: 0,
    jobsAdvanced: 0,
    jobsCompleted: 0,
    interruptsFired: 0,
  }

  const colonies = getAllColonyRecords()
  if (colonies.length === 0) return result

  const rng = getSimRng()

  for (const { poiId } of colonies) {
    const jobs = getConstructionJobs(poiId).filter((j) => j.status === 'in_progress')
    if (jobs.length === 0) continue

    const sceneId = getPrimaryDockScene(poiId)
    if (!sceneId) continue
    const w = getWorld(sceneId)

    let anyActive = false

    for (const job of jobs) {
      const updated: ConstructionJob = {
        ...job,
        daysRemaining: job.daysRemaining - 1,
      }

      if (updated.daysRemaining <= 0) {
        updated.status = 'completed'
        updated.daysRemaining = 0
        spawnCompletedFacilityInWorld(w, job.facilityType)
        result.jobsCompleted += 1
        emitSim('log', {
          textZh: `殖民地 ${poiId} 建设完成：${getBuildingType(job.facilityType).labelZh}。`,
          atMs: nowMs(),
        })
      } else {
        anyActive = true
      }

      updateConstructionJob(updated)
      result.jobsAdvanced += 1
    }

    // Interrupt roll — once per colony that still has active in-progress work.
    if (anyActive && rng.next() < colonyConfig.construction.interruptChancePerColonyDay) {
      const reason = rng.pick(INTERRUPT_REASONS)
      emitSim('hyperspeed:break', { reason })
      emitSim('log', { textZh: `殖民地 ${poiId} 施工中断：${reason}`, atMs: nowMs() })
      result.interruptsFired += 1
    }

    result.coloniesProcessed += 1
  }

  return result
}
