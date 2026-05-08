// Phase 5.5.6 research system. Walks every player-owned researchLab at
// day:rollover and credits research progress against the head of the
// owning faction's FactionResearch.queue.
//
// Per seated researcher, per worked shift today:
//   progress = baseResearchPerShift
//            × clamp(workPerformance, perfMin, perfMax)
//            × facilityEfficiencyMul     (defaults to 1.0 in 5.5.6 — the
//                                          facility-tier knob lands later)
//            × getStat(faction.sheet, 'researchSpeedMul')
//
// Accumulation: progress accrues against `queue[0]`. When
// `accumulated >= head.cost`, the head completes (effects applied, unlocks
// stamped, completed list appended) and the leftover rolls into the next
// queued entry. If the queue empties mid-day, the remainder is *lost* and
// reported in `lostOverflowToday` so the planner can surface "今日产出 N,
// 队列为空, 已丢失".
//
// All multipliers and base values live in research.json5 + the FactionSheet.
// No magic numbers in this file.

import type { Entity, World } from 'koota'
import {
  Building, Workstation, Position, Facility, Owner,
  Faction, FactionSheet, FactionResearch, Job, JobPerformance,
} from '../ecs/traits'
import { researchConfig } from '../config'
import { getResearchSpec, researchCatalog } from '../data/research'
import { getStat } from '../stats/sheet'
import {
  addFactionEffect, addFactionUnlock, type FactionEffect,
} from '../ecs/factionEffects'
import { emitSim } from '../sim/events'
import { useClock } from '../sim/clock'

export interface ResearchSystemResult {
  labsChecked: number
  researchersWorked: number
  progressGenerated: number
  completed: string[]
  lostOverflow: number
}

// Top-level entry. Called from loop.ts at day:rollover, AFTER
// dailyEconomicsSystem (so a foreclosed lab's revenueAcc is settled
// before research credits its progress) and recruitmentSystem (which
// only writes Applicant entities and doesn't perturb research state).
//
// `gameDay` is the integer day number AFTER the rollover has flipped.
export function researchSystem(
  world: World,
  _gameDay: number,
): ResearchSystemResult {
  const result: ResearchSystemResult = {
    labsChecked: 0,
    researchersWorked: 0,
    progressGenerated: 0,
    completed: [],
    lostOverflow: 0,
  }

  // Reset every faction's per-day yield + lost-overflow tally. The
  // planner reads `yesterdayPerDay` for ETA and `lostOverflowToday` for
  // the "今日产出 N, 已丢失" line; both must be authoritative for *today*
  // before we add this day's contribution.
  for (const fEnt of world.query(Faction, FactionResearch)) {
    const fr = fEnt.get(FactionResearch)!
    if (fr.lostOverflowToday !== 0) {
      fEnt.set(FactionResearch, { ...fr, lostOverflowToday: 0 })
    }
  }

  // Yield buckets per faction so we can compute yesterdayPerDay once at
  // the end (rather than after every lab when multiple labs feed the
  // same faction). Keyed by Faction entity reference.
  const yieldByFaction = new Map<Entity, number>()

  for (const lab of world.query(Building, Owner, Facility)) {
    if (lab.get(Building)!.typeId !== 'researchLab') continue
    const owner = lab.get(Owner)!
    if (owner.kind === 'state') continue

    const factionEnt = resolveOwningFaction(world, owner)
    if (!factionEnt) continue

    result.labsChecked += 1

    // Closed-on-insolvency labs produce nothing today (consistent with
    // workSystem skipping closed facilities for revenue).
    const fac = lab.get(Facility)!
    if (fac.closedSinceDay > 0) continue

    const labYield = computeLabYield(world, lab, factionEnt, result)
    if (labYield <= 0) continue

    yieldByFaction.set(factionEnt, (yieldByFaction.get(factionEnt) ?? 0) + labYield)
  }

  // Apply each faction's day yield in one pass: queue head accumulation,
  // overflow rollover, lost-when-empty reporting, yesterdayPerDay snapshot.
  for (const [factionEnt, dayYield] of yieldByFaction) {
    const completed = applyFactionDayYield(factionEnt, dayYield)
    result.completed.push(...completed)
    const fr = factionEnt.get(FactionResearch)!
    result.progressGenerated += dayYield
    result.lostOverflow += fr.lostOverflowToday
  }

  return result
}

// Resolve the FactionResearch carrier for an Owner. Faction-owned labs
// route to the named faction; character-owned (player only — no NPC AI
// buys labs in 5.5.6) routes to the 'civilian' alias the rest of the
// pre-5.5.5 player-faction surface already uses (members, facilities,
// beds — see src/ecs/playerFaction.ts).
function resolveOwningFaction(world: World, owner: { kind: string; entity: Entity | null }): Entity | null {
  if (owner.kind === 'faction' && owner.entity?.has(FactionResearch)) return owner.entity
  if (owner.kind === 'character' && owner.entity) {
    for (const fEnt of world.query(Faction, FactionResearch)) {
      if (fEnt.get(Faction)!.id === 'civilian') return fEnt
    }
  }
  return null
}

// Compute today's progress contribution from `lab`. Walks the lab's
// supervisor researcher; multiple-seat labs land with the facility-tier
// system in a later phase, so 5.5.6 collects from the single supervisor.
function computeLabYield(
  world: World,
  lab: Entity,
  factionEnt: Entity,
  result: ResearchSystemResult,
): number {
  const cfg = researchConfig
  const sheet = factionEnt.get(FactionSheet)!.sheet
  const speedMul = getStat(sheet, 'researchSpeedMul')

  let total = 0
  for (const ws of researcherStations(world, lab)) {
    const occ = ws.get(Workstation)!.occupant
    if (!occ) continue
    // Skip researchers whose Job pointer doesn't agree with the seat —
    // a half-applied install could otherwise double-count or count a
    // researcher who left mid-day.
    const job = occ.get(Job)
    if (!job || job.workstation !== ws) continue

    const perf = clampPerf(occ, cfg.perfMin, cfg.perfMax)
    const efficiency = 1.0  // facility-tier knob, defaults to 1.0 in 5.5.6
    const yieldFromSeat = cfg.baseResearchPerShift * perf * efficiency * speedMul
    total += yieldFromSeat
    result.researchersWorked += 1
  }
  return total
}

function clampPerf(npc: Entity, lo: number, hi: number): number {
  const jp = npc.get(JobPerformance)
  if (!jp) return 1.0
  const todayPerf01 = (jp.todayPerf || 0) / 100
  const baseline = todayPerf01 > 0 ? todayPerf01 : 1.0
  if (baseline < lo) return lo
  if (baseline > hi) return hi
  return baseline
}

// Walk the lab's interior workstations and surface every researcher seat.
function* researcherStations(world: World, lab: Entity): IterableIterator<Entity> {
  const bld = lab.get(Building)!
  for (const ws of world.query(Workstation, Position)) {
    const pos = ws.get(Position)!
    if (pos.x < bld.x || pos.x >= bld.x + bld.w) continue
    if (pos.y < bld.y || pos.y >= bld.y + bld.h) continue
    if (ws.get(Workstation)!.specId !== 'researcher') continue
    yield ws
  }
}

// Roll today's yield into the queue. Returns the ids that completed
// today so the caller can newsfeed-announce significant ones.
function applyFactionDayYield(factionEnt: Entity, dayYield: number): string[] {
  const completedToday: string[] = []
  let fr = factionEnt.get(FactionResearch)!
  let queue = fr.queue.slice()
  let accumulated = fr.accumulated
  let completed = fr.completed.slice()
  let lostOverflowToday = fr.lostOverflowToday
  let remaining = dayYield

  while (remaining > 0) {
    if (queue.length === 0) {
      lostOverflowToday += remaining
      remaining = 0
      break
    }
    const headId = queue[0]
    const spec = getResearchSpec(headId)
    if (!spec) {
      // Author-side error: a queued id with no catalog row. Drop the
      // entry rather than block forever; the player sees an empty queue
      // and re-plans.
      queue = queue.slice(1)
      accumulated = 0
      continue
    }
    const need = spec.cost - accumulated
    if (remaining < need) {
      accumulated += remaining
      remaining = 0
      break
    }
    // Head completes; overflow loops to the next entry.
    remaining -= need
    accumulated = 0
    queue = queue.slice(1)
    completed = [...completed, spec.id]
    completedToday.push(spec.id)
    applyCompletedResearch(factionEnt, spec)
  }

  factionEnt.set(FactionResearch, {
    queue, accumulated,
    yesterdayPerDay: dayYield,
    lostOverflowToday,
    completed,
  })

  for (const id of completedToday) {
    const spec = getResearchSpec(id)
    if (!spec) continue
    if (spec.significant) emitNewsfeed(factionEnt, spec.nameZh)
  }
  return completedToday
}

function applyCompletedResearch(
  factionEnt: Entity,
  spec: { id: string; effects: { statId: string; type: string; value: number }[]; unlocks: string[]; nameZh: string },
): void {
  if (spec.effects.length > 0) {
    const eff: FactionEffect = {
      id: `research:${spec.id}`,
      originId: spec.id,
      family: 'research',
      modifiers: spec.effects.map((m) => ({
        statId: m.statId as FactionEffect['modifiers'][number]['statId'],
        type: m.type as FactionEffect['modifiers'][number]['type'],
        value: m.value,
      })),
      nameZh: spec.nameZh,
    }
    addFactionEffect(factionEnt, eff)
  }
  for (const unlockId of spec.unlocks) {
    addFactionUnlock(factionEnt, unlockId)
  }
}

function emitNewsfeed(factionEnt: Entity, nameZh: string): void {
  const f = factionEnt.get(Faction)
  const fName = f ? f.id : 'faction'
  emitSim('log', {
    textZh: `${fName} 完成研究: ${nameZh}`,
    atMs: useClock.getState().gameDate.getTime(),
  })
}

// ── Public API for the planner / consultative branch ───────────────────

export interface ResearchQueueEntry {
  id: string
  nameZh: string
  descZh: string
  cost: number
  accumulatedAtHead: boolean
  accumulated: number
}

export interface ResearchPlannerView {
  queue: ResearchQueueEntry[]
  completed: string[]
  yesterdayPerDay: number
  lostOverflowToday: number
  available: { id: string; nameZh: string; descZh: string; cost: number; category: string }[]
  locked: { id: string; nameZh: string; descZh: string; cost: number; missingPrereqIds: string[] }[]
  done: { id: string; nameZh: string }[]
}

export function plannerView(faction: Entity): ResearchPlannerView | null {
  if (!faction.has(FactionResearch)) return null
  const fr = faction.get(FactionResearch)!
  const completedSet = new Set(fr.completed)
  const queueSet = new Set(fr.queue)

  const queueRows: ResearchQueueEntry[] = []
  for (const id of fr.queue) {
    const spec = getResearchSpec(id)
    if (!spec) continue
    queueRows.push({
      id, nameZh: spec.nameZh, descZh: spec.descZh, cost: spec.cost,
      accumulatedAtHead: queueRows.length === 0,
      accumulated: queueRows.length === 0 ? fr.accumulated : 0,
    })
  }

  const available: ResearchPlannerView['available'] = []
  const locked: ResearchPlannerView['locked'] = []
  const done: ResearchPlannerView['done'] = []
  // Iterate the full catalog so the planner can show locked rows too.
  for (const spec of researchCatalog) {
    if (completedSet.has(spec.id)) {
      done.push({ id: spec.id, nameZh: spec.nameZh })
      continue
    }
    if (queueSet.has(spec.id)) continue
    const missing = spec.prereqs.filter((p) => !completedSet.has(p))
    if (missing.length === 0) {
      available.push({
        id: spec.id, nameZh: spec.nameZh, descZh: spec.descZh,
        cost: spec.cost, category: spec.category,
      })
    } else {
      locked.push({
        id: spec.id, nameZh: spec.nameZh, descZh: spec.descZh,
        cost: spec.cost, missingPrereqIds: missing,
      })
    }
  }

  return {
    queue: queueRows,
    completed: fr.completed.slice(),
    yesterdayPerDay: fr.yesterdayPerDay,
    lostOverflowToday: fr.lostOverflowToday,
    available, locked, done,
  }
}

// Append `researchId` to the faction's queue. Validates: prereqs cleared,
// not already queued, not already done. Returns false if any check fails.
export function enqueueResearch(faction: Entity, researchId: string): boolean {
  const spec = getResearchSpec(researchId)
  if (!spec) return false
  if (!faction.has(FactionResearch)) return false
  const fr = faction.get(FactionResearch)!
  if (fr.queue.includes(researchId)) return false
  if (fr.completed.includes(researchId)) return false
  for (const p of spec.prereqs) {
    if (!fr.completed.includes(p)) return false
  }
  faction.set(FactionResearch, { ...fr, queue: [...fr.queue, researchId] })
  return true
}

// Remove a non-head queue entry. Returns false if the id is not in the
// queue or sits at the head (cancel-head goes through `cancelHead` so
// the caller can confirm the loss of accumulated progress).
export function dequeueResearch(faction: Entity, researchId: string): boolean {
  if (!faction.has(FactionResearch)) return false
  const fr = faction.get(FactionResearch)!
  const idx = fr.queue.indexOf(researchId)
  if (idx <= 0) return false
  const next = fr.queue.slice(0, idx).concat(fr.queue.slice(idx + 1))
  faction.set(FactionResearch, { ...fr, queue: next })
  return true
}

// Cancel the queue head. Discards `accumulated` (the friction that makes
// queue order a real commitment). Caller should confirm with the player
// before invoking.
export function cancelHead(faction: Entity): boolean {
  if (!faction.has(FactionResearch)) return false
  const fr = faction.get(FactionResearch)!
  if (fr.queue.length === 0) return false
  faction.set(FactionResearch, {
    ...fr,
    queue: fr.queue.slice(1),
    accumulated: 0,
  })
  return true
}

// Move an entry within the queue. `from === 0 && to > 0` discards
// accumulated; `to === 0 && from > 0` puts the moved entry at the head
// without crediting any accumulated; ordinary mid-queue moves are free.
// Returns false on any out-of-range index.
export function reorderQueue(faction: Entity, from: number, to: number): boolean {
  if (!faction.has(FactionResearch)) return false
  const fr = faction.get(FactionResearch)!
  if (from < 0 || from >= fr.queue.length) return false
  if (to < 0 || to >= fr.queue.length) return false
  if (from === to) return true
  const queue = fr.queue.slice()
  const [moved] = queue.splice(from, 1)
  queue.splice(to, 0, moved)
  // If the head is being displaced (from === 0), accumulated is discarded.
  // If a new entry is being moved to the head (to === 0), the previous
  // accumulated belonged to the old head — also discard it for that case
  // since the new head is fresh.
  const accumulated = (from === 0 || to === 0) ? 0 : fr.accumulated
  faction.set(FactionResearch, { ...fr, queue, accumulated })
  return true
}

// Locate the faction whose research a given researcher seat reports to.
// `station` is the researcher Workstation entity. Used by the planner UI
// to resolve "which faction's queue does this researcher work on?"
export function findFactionForResearcherStation(world: World, station: Entity): Entity | null {
  const pos = station.get(Position)
  if (!pos) return null
  for (const lab of world.query(Building, Owner)) {
    if (lab.get(Building)!.typeId !== 'researchLab') continue
    const bld = lab.get(Building)!
    if (pos.x < bld.x || pos.x >= bld.x + bld.w) continue
    if (pos.y < bld.y || pos.y >= bld.y + bld.h) continue
    return resolveOwningFaction(world, lab.get(Owner)!)
  }
  return null
}
