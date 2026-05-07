import type { World, Entity } from 'koota'
import { IsPlayer, Action, JobPerformance, Job, Money, Workstation, JobTenure, Attributes, Position, Facility, Owner, Building, Faction } from '../ecs/traits'
import { wageMultiplier, getJobSpec } from '../data/jobs'
import { isWorkstationOpen } from './market'
import { emitSim } from '../sim/events'
import { addSkillXp, type SkillId } from '../character/skills'
import { feedUse, statValue } from './attributes'
import { FEED, statMult } from '../character/stats'
import type { AttributeId } from '../character/stats'
import { economyConfig, economicsConfig, factionsConfig, facilityRevenuePerShift } from '../config'
import type { JobSpec } from '../config'
import { addRep } from './reputation'
import { checkPromotionEligibility } from './promotion'
import { getStat } from '../stats/sheet'
import { skillXpMulStat, type SkillStatId } from '../stats/schema'
import { findFacilityForPosition } from '../ecs/ownership'

function wageMul(entity: Entity): number {
  const a = entity.get(Attributes)
  return a ? getStat(a.sheet, 'wageMul') : 1
}

function workPerfMul(entity: Entity): number {
  const a = entity.get(Attributes)
  return a ? getStat(a.sheet, 'workPerfMul') : 1
}

function skillXpMul(entity: Entity, skill: SkillStatId): number {
  const a = entity.get(Attributes)
  return a ? getStat(a.sheet, skillXpMulStat(skill)) : 1
}

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
  ws: Entity,
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
    // Phase 5.5.2 — facility owner pays the worker's wage and books the
    // shift's revenue. The facility lookup runs once per shift transition;
    // a closed facility (insolvency day 2+) zeros both wage and revenue —
    // workers stop showing up for an unpaid boss.
    const facilityEnt = findFacilityFor(world, ws)
    const closedFacility = facilityEnt?.get(Facility)?.closedSinceDay ?? 0
    const facilityClosed = closedFacility > 0

    if (todayPerf > 0 && spec.wage > 0 && !facilityClosed) {
      const npcBonus = isPlayer ? 1.0 : economyConfig.wage.npcBonus
      const attrMult = statMult(statValue(entity, jobAttr(spec)))
      // Intelligence multiplies skill XP across all jobs; per-skill perks
      // stack on top via the <skill>XpMul stat.
      const intMult = statMult(statValue(entity, 'intelligence'))
      const skillMul = spec.skill ? skillXpMul(entity, spec.skill as SkillStatId) : 1
      const wage = Math.floor(spec.wage * wageMultiplier(todayPerf) * npcBonus * attrMult * wageMul(entity))
      const xpGain = spec.skill ? Math.floor(spec.skillXp * (todayPerf / 100) * intMult * skillMul) : 0

      if (facilityEnt) accrueShiftEconomics(facilityEnt, todayPerf, wage)

      const m = entity.get(Money)
      if (m && wage > 0) entity.set(Money, { amount: m.amount + wage })
      if (spec.skill && xpGain > 0) {
        addSkillXp(entity, spec.skill as SkillId, xpGain)
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
    // Per-minute perf increment scaled by workPerfMul so a sick or injured
    // worker produces less without workSystem needing to know about
    // conditions. Clamped at 0 — a punitive Effect can stall progress
    // entirely (no negative perf).
    const inc = Math.max(0, (100 / totalWindowMin) * workPerfMul(entity))
    todayPerf = Math.min(100, todayPerf + inc)
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

// Phase 5.5.2 — find the ownable Facility containing a given Workstation.
// State-owned facilities short-circuit accrual (the city eats the cost),
// matching dailyEconomics's skip rule. Returns null when the workstation
// sits inside a non-ownable Building (e.g. a ship room — Building without
// Facility) or outside any building.
function findFacilityFor(world: World, ws: Entity): Entity | null {
  const wsPos = ws.get(Position)
  if (!wsPos) return null
  const facility = findFacilityForPosition(world, wsPos)
  if (!facility) return null
  const owner = facility.get(Owner)
  if (!owner || owner.kind === 'state') return null
  return facility
}

// Apply a single completed shift's contribution to the facility's day
// accumulators. Salary is the wage workSystem just paid the worker.
// Revenue scales the per-shift base by the worker's perf and the
// configured owner-kind / faction multipliers.
function accrueShiftEconomics(facility: Entity, todayPerf: number, wage: number): void {
  const fac = facility.get(Facility)!
  const bld = facility.get(Building)
  const owner = facility.get(Owner)
  if (!bld || !owner || owner.kind === 'state') return

  const baseRevenue = facilityRevenuePerShift(bld.typeId)
  const ownerKindMul = economicsConfig.ownerKindMul[owner.kind].revenueMul
  let factionMul = 1
  if (owner.kind === 'faction' && owner.entity) {
    const factionTrait = owner.entity.get(Faction)
    if (factionTrait) {
      factionMul = economicsConfig.factions[factionTrait.id]?.revenueMul ?? 1
    }
  }
  const perf01 = Math.max(0, Math.min(1, todayPerf / 100))
  const revenue = Math.round(
    baseRevenue * perf01 * economicsConfig.global.revenueMul * ownerKindMul * factionMul,
  )
  facility.set(Facility, {
    ...fac,
    revenueAcc: fac.revenueAcc + revenue,
    salariesAcc: fac.salariesAcc + Math.max(0, wage),
  })
}

export { isWorkstationOpen }
