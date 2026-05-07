// Phase 5.5.2 daily economics rollover. Runs once per game day, after
// `day:rollover` fires from the loop. For each ownable Building:
//
//   ownerNet = revenueAcc - salariesAcc - maintenance
//
// `revenueAcc` and `salariesAcc` are filled in by workSystem at end-of-
// shift. Maintenance is a flat per-day cost from economics.json5 and
// charges every day, even on unstaffed facilities — that's the diegetic
// pressure that makes shuttering an unprofitable bar a real choice.
//
// Insolvency: a facility whose owner can't cover end-of-day net flips
// into a 3-day grace counter (`Facility.insolventDays`). On day 1 the
// player gets a named-worker warning toast. On day 2 the facility
// closes (`closedSinceDay`) and workers refuse the next shift —
// workSystem reads the flag. On day 3 ownership reverts to state and
// the foreclosure lands on the realtor's listing.
//
// Faction-owned facilities run the same path; sponsored factions get a
// daily stipend (`economicsConfig.factions.<id>.dailyStipend`) credited
// before the rollup so AE-tier owners stay solvent without facility
// revenue. State ownership short-circuits the whole pipeline.

import type { Entity, World, TraitInstance } from 'koota'
import {
  Building, Owner, Facility, Faction,
  Character, IsPlayer, EntityKey, Workstation, Position,
} from '../ecs/traits'
import {
  economicsConfig, facilityMaintenancePerDay, factionsConfig,
} from '../config'
import { applyOwnerFundDelta, ownerCanPay } from '../ecs/ownership'
import { emitSim } from '../sim/events'
import { useClock } from '../sim/clock'

export interface DailyEconomicsResult {
  facilitiesProcessed: number
  foreclosed: number
  insolventStarted: number
  warnings: number
}

type OwnerInstance = TraitInstance<typeof Owner>

// Pure rollover. `gameDay` is the integer day number AFTER the rollover
// has flipped. workSystem accumulates revenue/salary into the Facility
// during a day; this run reads + zeroes them for the next day.
export function dailyEconomicsSystem(
  world: World,
  gameDay: number,
): DailyEconomicsResult {
  const result: DailyEconomicsResult = {
    facilitiesProcessed: 0,
    foreclosed: 0,
    insolventStarted: 0,
    warnings: 0,
  }

  applyFactionStipends(world, gameDay)

  for (const ent of world.query(Building, Owner, Facility, EntityKey)) {
    const owner = ent.get(Owner)!
    if (owner.kind === 'state') continue

    const fac = ent.get(Facility)!
    // Same-day double-fire guard. Tests advance the clock manually and
    // can re-emit day:rollover; loop.ts also re-fires on load. Either
    // way, processing the same day twice would double-charge maintenance.
    if (fac.lastRolloverDay === gameDay) continue

    const bld = ent.get(Building)!
    const maintenance = facilityMaintenancePerDay(bld.typeId)
    const net = fac.revenueAcc - fac.salariesAcc - maintenance

    result.facilitiesProcessed += 1

    let solvent = true
    if (net >= 0) {
      applyOwnerFundDelta(ent, net)
    } else {
      const deficit = -net
      if (ownerCanPay(ent, deficit)) {
        applyOwnerFundDelta(ent, net)
      } else {
        solvent = false
      }
    }

    let next: typeof fac = {
      ...fac,
      revenueAcc: 0, salariesAcc: 0, lastRolloverDay: gameDay,
    }

    if (solvent) {
      if (fac.insolventDays > 0 || fac.closedSinceDay > 0) {
        next = {
          ...next,
          insolventDays: 0,
          closedSinceDay: 0,
          closedReason: null,
        }
      }
      ent.set(Facility, next)
      continue
    }

    // Insolvent. The unpaid deficit doesn't carry — owner fund stays put,
    // the warning surface lights up, the grace counter advances.
    const insolventDays = fac.insolventDays + 1
    const grace = economicsConfig.insolvency.gracePeriodDays

    if (insolventDays >= grace) {
      ent.set(Owner, { kind: 'state', entity: null })
      ent.set(Facility, {
        ...next,
        insolventDays: 0,
        closedSinceDay: 0,
        closedReason: null,
      })
      result.foreclosed += 1
      announceForeclosure(world, ent, owner)
      continue
    }

    if (insolventDays === 1) {
      result.insolventStarted += 1
      result.warnings += 1
      announceInsolvencyDayOne(world, ent, owner)
      next = { ...next, insolventDays }
    } else {
      result.warnings += 1
      next = {
        ...next,
        insolventDays,
        closedSinceDay: gameDay,
        closedReason: 'insolvent',
      }
      announceInsolvencyDayTwo(world, ent, owner)
    }
    ent.set(Facility, next)
  }

  return result
}

// One stipend per faction per day, applied before facility rollups.
// Tracked in a module-local map cleared by resetDailyEconomics().
const lastStipendDayByFaction = new Map<string, number>()

function applyFactionStipends(world: World, gameDay: number): void {
  for (const e of world.query(Faction)) {
    const f = e.get(Faction)!
    if (lastStipendDayByFaction.get(f.id) === gameDay) continue
    const fc = economicsConfig.factions[f.id]
    if (!fc) continue
    if (fc.dailyStipend > 0) {
      e.set(Faction, { ...f, fund: f.fund + fc.dailyStipend })
    }
    lastStipendDayByFaction.set(f.id, gameDay)
  }
}

export function resetDailyEconomics(): void {
  lastStipendDayByFaction.clear()
}

// ── Embodied warning loop ────────────────────────────────────────────────

function nowMs(): number {
  return useClock.getState().gameDate.getTime()
}

function emitLog(textZh: string): void {
  emitSim('log', { textZh, atMs: nowMs() })
}

function announceInsolvencyDayOne(world: World, facility: Entity, _owner: OwnerInstance): void {
  if (!isPlayerOwner(facility)) return
  const facName = friendlyFacilityName(facility)
  const workerName = pickFacilityWorkerName(world, facility) ?? '一名员工'
  const text = `${workerName}：「老板，${facName}的工资没发出去——能跟你聊聊吗？」`
  emitSim('toast', { textZh: text, durationMs: 8000 })
  emitLog(text)
  if (economicsConfig.insolvency.warningHyperspeedBreak) {
    emitSim('hyperspeed:break', { reason: 'facility-insolvent' })
  }
}

function announceInsolvencyDayTwo(_world: World, facility: Entity, _owner: OwnerInstance): void {
  if (!isPlayerOwner(facility)) return
  const facName = friendlyFacilityName(facility)
  const text = `${facName}今天没人开门——员工等在外面，没拿到工资。`
  emitSim('toast', { textZh: text, durationMs: 8000 })
  emitLog(text)
  if (economicsConfig.insolvency.warningHyperspeedBreak) {
    emitSim('hyperspeed:break', { reason: 'facility-closed' })
  }
}

function announceForeclosure(_world: World, facility: Entity, owner: OwnerInstance): void {
  const facName = friendlyFacilityName(facility)
  if (isPlayerOwnerFromTrait(owner)) {
    const text = `${facName}已被市政府接管 · 三天没发出工资。`
    emitSim('toast', { textZh: text, durationMs: 10000 })
    emitLog(text)
    if (economicsConfig.insolvency.warningHyperspeedBreak) {
      emitSim('hyperspeed:break', { reason: 'facility-foreclosed' })
    }
    return
  }
  const ownerName = ownerDisplayName(owner) ?? '业主'
  emitLog(`${facName}易主：${ownerName}三日未发工资，被市政府收回。`)
}

function isPlayerOwner(facility: Entity): boolean {
  return isPlayerOwnerFromTrait(facility.get(Owner))
}

function isPlayerOwnerFromTrait(owner: OwnerInstance | undefined): boolean {
  if (!owner) return false
  if (owner.kind !== 'character') return false
  const c = owner.entity
  if (!c) return false
  return c.has(IsPlayer)
}

function ownerDisplayName(owner: OwnerInstance | undefined): string | null {
  if (!owner) return null
  if (owner.kind === 'character' && owner.entity) {
    return owner.entity.get(Character)?.name ?? null
  }
  if (owner.kind === 'faction' && owner.entity) {
    const f = owner.entity.get(Faction)
    return f ? factionsConfig.catalog[f.id]?.shortZh ?? f.id : null
  }
  return null
}

function friendlyFacilityName(facility: Entity): string {
  return facility.get(Building)?.label ?? '设施'
}

// First named worker inside the facility — dresses the day-1 toast.
// Returns null when the facility runs unstaffed (still insolvent, just
// without a name attached to the warning).
function pickFacilityWorkerName(world: World, facility: Entity): string | null {
  const b = facility.get(Building)!
  const x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h
  for (const ws of world.query(Workstation, Position)) {
    const pos = ws.get(Position)!
    if (pos.x < x0 || pos.x >= x1) continue
    if (pos.y < y0 || pos.y >= y1) continue
    const occ = ws.get(Workstation)!.occupant
    if (!occ) continue
    const ch = occ.get(Character)
    if (ch?.name) return ch.name
  }
  return null
}
