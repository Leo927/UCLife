// Phase 6.3.C — colony construction system.
// Advances in-progress construction jobs on each day:rollover:settled tick.
// Wired via src/boot/colonyConstructionTick.ts.
//
// Perf budget: O(colonies × jobs_per_colony) once per game-day. Target N is
// a few colonies × a few concurrent builds — trivially sub-budget on the
// daily tick.

import { Building } from '../ecs/traits'
import {
  getAllColonyRecords,
  getConstructionJobs,
  updateConstructionJob,
  type ConstructionJob,
} from '../sim/colony'
import { colonyConfig } from '../config'
import { getPrimaryDockScene } from '../data/pois'
import { getBuildingType } from '../data/buildingTypes'
import { getWorld } from '../ecs/world'
import { getSimRng } from '../sim/rng'
import { emitSim } from '../sim/events'
import { useClock } from '../sim/clock'

export interface ColonyConstructionResult {
  coloniesProcessed: number
  jobsAdvanced: number
  jobsCompleted: number
  interruptsTriggered: number
}

const INTERRUPT_REASONS = [
  '施工意外：工人受伤，暂停快进',
  '阵营督察到访：需要暂停配合检查',
  '供给船遭到拦截：后勤中断，暂停快进',
] as const

export function colonyConstructionSystem(gameDay: number): ColonyConstructionResult {
  const result: ColonyConstructionResult = {
    coloniesProcessed: 0,
    jobsAdvanced: 0,
    jobsCompleted: 0,
    interruptsTriggered: 0,
  }

  const colonies = getAllColonyRecords()
  if (colonies.length === 0) return result

  const rng = getSimRng()
  const interruptChance = colonyConfig.construction.interruptChancePerJobPerDay

  for (const { poiId } of colonies) {
    const jobs = getConstructionJobs(poiId)
    const inProgress = jobs.filter((j) => j.status === 'inProgress')
    if (inProgress.length === 0) continue

    const sceneId = getPrimaryDockScene(poiId)
    if (!sceneId) continue

    let colonyHadInterrupt = false
    result.coloniesProcessed += 1

    for (const job of inProgress) {
      result.jobsAdvanced += 1

      if (!colonyHadInterrupt && rng.next() < interruptChance) {
        colonyHadInterrupt = true
        result.interruptsTriggered += 1
        fireConstructionInterrupt(rng.pick(INTERRUPT_REASONS))
      }

      const elapsed = gameDay - job.authorizedDay
      if (elapsed >= job.durationDays) {
        completeJob(job, sceneId)
        result.jobsCompleted += 1
      }
    }
  }

  return result
}

function completeJob(job: ConstructionJob, sceneId: string): void {
  updateConstructionJob(job.poiId, job.id, { status: 'completed' })

  const bldType = getBuildingType(job.facilityTypeId)
  const w = getWorld(sceneId)
  w.spawn(Building({ typeId: job.facilityTypeId, label: bldType.labelZh, x: 0, y: 0, w: 0, h: 0 }))

  emitSim('log', {
    textZh: `${job.poiId} 新设施建成：${bldType.labelZh}`,
    atMs: useClock.getState().gameDate.getTime(),
  })
}

export function fireConstructionInterrupt(reason: string): void {
  useClock.getState().setSpeed(0)
  emitSim('hyperspeed:break', { reason })
  emitSim('toast', { textZh: reason })
}
