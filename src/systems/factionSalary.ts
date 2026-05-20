// Unified player-faction salary system. Walks every NPC carrying
// RecruitedTo({ owner: player }) across all scene worlds and debits the
// player's Money once per game day. There is no separate fleet-crew
// channel — ship crew are faction members slotted into ship seats and
// draw the same base rate from this system.
//
// Per-member wage is computed by demandedDailyWage(). Today that's a
// flat base + captain bonus; later it'll read the member's StatSheet
// and bump the demand for high-skilled hires, with loyalty drift when
// the player pays under the demand.
//
// Recruited NPCs do NOT also draw a per-shift wage — workSystem zeros
// their wage payout when they have RecruitedTo, so the facility owner
// keeps the full revenue and this system is the only pay channel.
//
// Mothballed-ship rule: an EmployedAsCrew member on a mothballed ship
// is off the books for the day — they draw nothing, matching the
// design-doc behavior that mothballing kills supply + salary drain on
// a hull.

import type { Entity, World, TraitInstance } from 'koota'
import {
  Character, EmployedAsCrew, IsPlayer, Money, RecruitedTo, Ship, EntityKey,
} from '../ecs/traits'
import { getWorld, SCENE_IDS } from '../ecs/world'
import { fleetConfig, recruitmentConfig } from '../config'

// Daily salary owed to one recruited NPC. Currently a flat base plus a
// captain bonus; this is the seam where stat-driven wage demands will
// land — a high-skilled member will demand more than the base, and
// paying below the demand will leak loyalty.
function demandedDailyWage(
  _npc: Entity,
  employed: TraitInstance<typeof EmployedAsCrew> | null,
): number {
  let wage = recruitmentConfig.factionMemberDailySalary
  if (employed?.role === 'captain') {
    wage += fleetConfig.captainSalaryBonus
  }
  return wage
}

export interface FactionSalaryResult {
  membersPaid: number
  captainsPaid: number
  crewPaid: number
  mothballed: number
  totalDebit: number
  shortfall: number
}

export function factionSalarySystem(
  _world: World,
  _gameDay: number,
): FactionSalaryResult {
  const out: FactionSalaryResult = {
    membersPaid: 0,
    captainsPaid: 0,
    crewPaid: 0,
    mothballed: 0,
    totalDebit: 0,
    shortfall: 0,
  }

  let player: Entity | null = null
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    const ent = w.queryFirst(IsPlayer, Money)
    if (ent) { player = ent; break }
  }
  if (!player) return out
  const m = player.get(Money)
  if (!m) return out

  const shipMothballedCache = new Map<string, boolean>()
  const isShipMothballed = (shipKey: string): boolean => {
    const cached = shipMothballedCache.get(shipKey)
    if (cached !== undefined) return cached
    const shipWorld = getWorld('playerShipInterior')
    let mothballed = false
    for (const s of shipWorld.query(Ship, EntityKey)) {
      if (s.get(EntityKey)!.key !== shipKey) continue
      mothballed = !!s.get(Ship)!.mothballed
      break
    }
    shipMothballedCache.set(shipKey, mothballed)
    return mothballed
  }

  let totalRequested = 0
  for (const sceneId of SCENE_IDS) {
    const w = getWorld(sceneId)
    for (const npc of w.query(Character, RecruitedTo)) {
      if (npc.has(IsPlayer)) continue
      const r = npc.get(RecruitedTo)
      if (!r || r.owner !== player) continue

      const employed = npc.has(EmployedAsCrew) ? npc.get(EmployedAsCrew)! : null
      if (employed && isShipMothballed(employed.shipKey)) {
        out.mothballed += 1
        continue
      }

      totalRequested += demandedDailyWage(npc, employed)
      out.membersPaid += 1
      if (employed?.role === 'captain') {
        out.captainsPaid += 1
      } else if (employed?.role === 'crew') {
        out.crewPaid += 1
      }
    }
  }

  const paid = Math.min(m.amount, totalRequested)
  out.totalDebit = paid
  out.shortfall = Math.max(0, totalRequested - paid)
  if (paid > 0) player.set(Money, { amount: m.amount - paid })
  return out
}
