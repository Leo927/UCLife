import type { World, Entity } from 'koota'
import { IsPlayer, Action, JobPerformance, Job, Money, Skills, Workstation, JobTenure } from '../ecs/traits'
import { wageMultiplier, getJobSpec } from '../data/jobs'
import { isWorkstationOpen } from './market'
import { emitSim } from '../sim/events'
import type { SkillId } from '../character/skills'
import { feedUse, statValue } from './attributes'
import { FEED, statMult } from '../character/stats'
import type { AttributeId } from '../character/stats'
import { economyConfig, factionsConfig } from '../config'
import type { JobSpec } from '../config'
import { addRep } from './reputation'
import { checkPromotionEligibility } from './promotion'

const MS_PER_DAY = 24 * 60 * 60 * 1000

function dayId(date: Date): number {
  return Math.floor(date.getTime() / MS_PER_DAY)
}

export function workSystem(world: World, gameDateAfter: Date, totalMinutes: number) {
  const startMs = gameDateAfter.getTime() - totalMinutes * 60_000

  // Player path: same wage/perf as NPCs, but emits a payout toast.
  const player = world.queryFirst(IsPlayer, Job, JobPerformance)
  if (player) {
    const j = player.get(Job)
    const ws = j?.workstation ?? null
    const w = ws?.get(Workstation) ?? null
    const spec = w ? getJobSpec(w.specId) : null
    if (ws && spec) {
      for (let m = 0; m < totalMinutes; m++) {
        const t = new Date(startMs + (m + 1) * 60_000)
        processMinute(world, player, ws, spec, t, /*isPlayer*/ true)
      }
    }
  }

  for (const npc of world.query(Job, JobPerformance, Action)) {
    if (npc === player) continue
    const j = npc.get(Job)
    const ws = j?.workstation ?? null
    const w = ws?.get(Workstation) ?? null
    const spec = w ? getJobSpec(w.specId) : null
    if (!ws || !spec) continue
    for (let m = 0; m < totalMinutes; m++) {
      const t = new Date(startMs + (m + 1) * 60_000)
      processMinute(world, npc, ws, spec, t, /*isPlayer*/ false)
    }
  }
}

function jobAttr(spec: JobSpec): AttributeId {
  if (spec.skill === 'mechanics') return 'strength'
  if (spec.skill === 'computers' || spec.skill === 'medicine') return 'intelligence'
  return 'charisma'
}

function processMinute(
  world: World,
  entity: Entity,
  _ws: Entity,
  spec: JobSpec,
  gameDate: Date,
  isPlayer: boolean,
) {
  const perf = entity.get(JobPerformance)!
  const action = entity.get(Action)!

  let { todayPerf, lastUpdateDay, wasInWindow } = perf
  const today = dayId(gameDate)
  const inWindow = isInWorkWindowInline(spec, gameDate)
  const totalWindowMin = (spec.shiftEnd - spec.shiftStart) * 60

  // End-of-shift payout MUST run before the day-rollover reset: midnight
  // shifts flip the calendar day on the same minute the payout fires.
  if (wasInWindow && !inWindow) {
    if (todayPerf > 0 && spec.wage > 0) {
      const npcBonus = isPlayer ? 1.0 : economyConfig.wage.npcBonus
      const attrMult = statMult(statValue(entity, jobAttr(spec)))
      // Intelligence multiplies skill XP across all jobs.
      const intMult = statMult(statValue(entity, 'intelligence'))
      const wage = Math.floor(spec.wage * wageMultiplier(todayPerf) * npcBonus * attrMult)
      const xpGain = spec.skill ? Math.floor(spec.skillXp * (todayPerf / 100) * intMult) : 0

      const m = entity.get(Money)
      if (m && wage > 0) entity.set(Money, { amount: m.amount + wage })
      if (spec.skill && xpGain > 0) {
        const s = entity.get(Skills)
        if (s) entity.set(Skills, { ...s, [spec.skill as SkillId]: s[spec.skill as SkillId] + xpGain })
      }

      if (isPlayer) {
        const perfStr = `${Math.round(todayPerf)}%`
        if (wage > 0) {
          emitSim('toast', { textZh: `下班 · ¥${wage} (绩效 ${perfStr})` })
        } else {
          emitSim('toast', { textZh: `下班 · 绩效 ${perfStr} 过低 · 无工资` })
        }
      }

      // Career-ladder is player-only — NPCs lack rep/tenure so AE rank-3+
      // stays unfilled and reserved for the player.
      if (isPlayer) {
        if (entity.has(JobTenure)) {
          const t = entity.get(JobTenure)!
          entity.set(JobTenure, { shiftsAtCurrentRank: t.shiftsAtCurrentRank + 1 })
        }
        if (spec.employer) {
          const fm = factionsConfig.catalog[spec.employer]
          if (fm && fm.repPerShift !== 0) addRep(entity, spec.employer, fm.repPerShift)
        }
        checkPromotionEligibility(world, entity)
      }
    }
    if (action.kind === 'working') {
      entity.set(Action, { kind: 'idle', remaining: 0, total: 0 })
    }
  }

  if (lastUpdateDay !== today) {
    todayPerf = 0
    lastUpdateDay = today
  }

  if (action.kind === 'working' && inWindow && totalWindowMin > 0) {
    todayPerf = Math.min(100, todayPerf + 100 / totalWindowMin)
    feedUse(entity, jobAttr(spec), FEED.work, 1)
    feedUse(entity, 'endurance', FEED.work, 1)
  }

  entity.set(JobPerformance, { todayPerf, lastUpdateDay, wasInWindow: inWindow })
}

// Avoids the double catalog lookup of isInWorkWindowWS in the per-minute loop.
function isInWorkWindowInline(spec: JobSpec, date: Date): boolean {
  if (!spec.workDays.includes(date.getDay())) return false
  const m = date.getHours() * 60 + date.getMinutes()
  return m >= spec.shiftStart * 60 && m < spec.shiftEnd * 60
}

export { isWorkstationOpen }
