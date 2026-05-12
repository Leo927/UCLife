// Phase 4.2 — workplace prevalence log line.
//
// When the player begins a work shift, count symptomatic infectious
// coworkers and emit one zh-CN log line if the count crosses the
// configured threshold. Gated to once per game-day per player via a
// `lastWorkplacePrevalenceDay` stamp on JobPerformance, so re-entering
// the same shift after a stutter doesn't spam.
//
// Coworker definition is the union of two heuristics:
//   - Workstations sharing the same `managerStation` link (managed
//     workplaces — factory floor, AE clerk pool).
//   - Workstations whose `specId` matches the player's, only when
//     neither side has a managerStation (unmanaged role pools — solo
//     shopkeeper, lone bartender).
// The manager workstation itself is treated as a coworker when the
// player is a subordinate, and subordinates are treated as coworkers
// when the player IS the manager.
//
// Design refs:
//   Design/characters/physiology-ux.md § 11 (Contagion awareness)
//   Design/characters/physiology.md § Contagion

import type { Entity, World } from 'koota'
import { Conditions, Health, IsPlayer, Job, JobPerformance, Workstation } from '../ecs/traits'
import type { ConditionPhase } from '../ecs/traits'
import { CONDITIONS } from '../character/conditions'
import { emitSim } from '../sim/events'
import { physiologyConfig } from '../config'

const MS_PER_DAY = 24 * 60 * 60 * 1000

function dayId(date: Date): number {
  return Math.floor(date.getTime() / MS_PER_DAY)
}

let infectiousIdSet: ReadonlySet<string> | null = null
function getInfectiousTemplateIds(): ReadonlySet<string> {
  if (infectiousIdSet) return infectiousIdSet
  const out = new Set<string>()
  for (const t of CONDITIONS) if (t.infectious) out.add(t.id)
  infectiousIdSet = out
  return out
}

function isSymptomaticPhase(phase: ConditionPhase): boolean {
  return phase === 'rising' || phase === 'peak' || phase === 'recovering' || phase === 'stalled'
}

// True when the entity carries a symptomatic instance of any
// `infectious=true` condition template. Shared with the worldspace
// sneeze-emote renderer so both consumers use one definition of
// "currently shedding".
export function isSymptomaticInfectiousCarrier(entity: Entity): boolean {
  const cond = entity.get(Conditions)
  if (!cond || cond.list.length === 0) return false
  const ifx = getInfectiousTemplateIds()
  for (const inst of cond.list) {
    if (!ifx.has(inst.templateId)) continue
    if (isSymptomaticPhase(inst.phase)) return true
  }
  return false
}

// Workplace-grouping predicate. Walks the four ways two stations can
// belong to the same workplace; intentionally permissive so a shift
// lead is still flagged as a "coworker" for log purposes.
function isCoworkerWorkstation(playerWs: Entity, otherWs: Entity): boolean {
  if (otherWs === playerWs) return false
  const pw = playerWs.get(Workstation)
  const ow = otherWs.get(Workstation)
  if (!pw || !ow) return false
  if (pw.managerStation && ow.managerStation && pw.managerStation === ow.managerStation) return true
  if (pw.managerStation && otherWs === pw.managerStation) return true
  if (ow.managerStation && playerWs === ow.managerStation) return true
  if (!pw.managerStation && !ow.managerStation && pw.specId === ow.specId) return true
  return false
}

// Returns the number of symptomatic infectious carriers among the
// player's coworkers in `world`. Exported for the unit test (and the
// sneeze-emote / inspector surfaces if they ever want the same readback).
export function countSymptomaticCoworkers(world: World, player: Entity): number {
  const j = player.get(Job)
  const playerWs = j?.workstation ?? null
  if (!playerWs) return 0
  let count = 0
  for (const ws of world.query(Workstation)) {
    if (!isCoworkerWorkstation(playerWs, ws)) continue
    const w = ws.get(Workstation)!
    const occ = w.occupant
    if (!occ) continue
    if (occ === player) continue
    const h = occ.get(Health)
    if (h?.dead) continue
    if (isSymptomaticInfectiousCarrier(occ)) count++
  }
  return count
}

// Hook called when the player's Action transitions to 'working'. Emits
// at most one log line per game-day. Returns true if the line fired so
// the call site (or tests) can assert on it.
export function maybeEmitWorkplacePrevalence(
  world: World,
  player: Entity,
  gameDate: Date,
): boolean {
  if (!player.has(IsPlayer)) return false
  const jp = player.get(JobPerformance)
  if (!jp) return false
  const today = dayId(gameDate)
  if (jp.lastWorkplacePrevalenceDay === today) return false
  const count = countSymptomaticCoworkers(world, player)
  const threshold = physiologyConfig.workplacePrevalenceThreshold
  if (count < threshold) return false
  emitSim('log', { textZh: `今天有${count}位同事请病假。`, atMs: gameDate.getTime() })
  player.set(JobPerformance, { ...jp, lastWorkplacePrevalenceDay: today })
  return true
}
