// Phase 5.5.3 secretary delegate operations. Pure functions backing the
// SecretaryConversation verbs:
//
//   • assignIdleMembers — fill vacant player-owned stations from the
//     idle-member pool, return a one-line zh-CN summary.
//   • assignBeds        — claim unclaimed player-owned beds for housed-
//                          stranger members so housing pressure clears.
//   • bookSummary       — fund / today's net / top expenses + revenues.
//   • sidewaysReport    — insolvent facilities + vacant stations +
//                          unhoused members.
//
// All four are read-mostly aggregators except assignIdleMembers and
// assignBeds, which mutate state. Conversation glue stays in
// SecretaryConversation.tsx; this file is testable in isolation.

import type { Entity, World } from 'koota'
import {
  Bed, Building, Character, EntityKey, Facility, Job, Money, Position,
  Workstation,
} from '../ecs/traits'
import { getJobSpec } from '../data/jobs'
import {
  facilityMaintenancePerDay,
} from '../config'
import {
  clearMemberJob,
  couldFillStation,
  findPlayer,
  idlePlayerFactionMembers,
  memberDisplayName,
  playerFactionMembers,
  playerOwnedBuildings,
  playerOwnedWorkstations,
  unclaimedPlayerOwnedBeds,
  unhousedPlayerFactionMembers,
  vacantPlayerOwnedWorkstations,
} from '../ecs/playerFaction'

export interface AssignmentSummary {
  assigned: number
  unassigned: number
  perFacility: { label: string; count: number }[]
}

// "Roster the idle members and assign where they fit." Walks idle members,
// fills any vacant station they can fill, and produces a per-facility tally
// for the secretary's one-sentence reply.
export function assignIdleMembers(
  world: World,
  player: Entity,
): AssignmentSummary {
  const idle = idlePlayerFactionMembers(world, player)
  const vacancies = vacantPlayerOwnedWorkstations(world, player)

  // Fill in entity-key sort order so the operation is deterministic across
  // saves — same idle + same vacancies → same assignment.
  idle.sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
  vacancies.sort((a, b) => keyOf(a.ws).localeCompare(keyOf(b.ws)))

  const perBuilding = new Map<Entity, number>()
  let assigned = 0

  for (const member of idle) {
    const slot = vacancies.findIndex(({ ws }) => couldFillStation(member, ws))
    if (slot < 0) continue
    const { ws, building } = vacancies[slot]
    const cur = ws.get(Workstation)!
    if (cur.occupant !== null) continue
    clearMemberJob(member)
    ws.set(Workstation, { ...cur, occupant: member })
    member.set(Job, { workstation: ws, unemployedSinceMs: 0 })
    vacancies.splice(slot, 1)
    perBuilding.set(building, (perBuilding.get(building) ?? 0) + 1)
    assigned += 1
  }

  const perFacility = Array.from(perBuilding.entries())
    .map(([b, count]) => ({ label: b.get(Building)?.label ?? '设施', count }))
    .sort((a, b) => b.count - a.count)

  return { assigned, unassigned: idle.length - assigned, perFacility }
}

export interface BedAssignmentSummary {
  assigned: number
  unhousedRemaining: number
}

// Match unhoused members to unclaimed beds in player-owned residences.
// Cheap and one-shot — the secretary is doing this in bulk on demand.
export function assignBeds(
  world: World,
  player: Entity,
): BedAssignmentSummary {
  const beds = unclaimedPlayerOwnedBeds(world, player)
  const unhoused = unhousedPlayerFactionMembers(world, player)
  beds.sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
  unhoused.sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
  let assigned = 0
  const limit = Math.min(beds.length, unhoused.length)
  for (let i = 0; i < limit; i++) {
    const bed = beds[i]
    const member = unhoused[i]
    const cur = bed.get(Bed)!
    bed.set(Bed, { ...cur, claimedBy: member })
    assigned += 1
  }
  return {
    assigned,
    unhousedRemaining: unhoused.length - assigned,
  }
}

export interface BooksSummary {
  fund: number
  todayRevenue: number
  todaySalaries: number
  todayMaintenance: number
  todayNet: number
  topRevenue: { label: string; amount: number }[]
  topExpense: { label: string; amount: number }[]
}

// "Read me the books." Sum the active scene's player-owned facilities by
// today's accumulators (workSystem fills these between rollovers, so the
// number is "what you've earned + paid so far today"). Maintenance is the
// per-day flat charge; today's net subtracts it as a forward look so the
// summary reads as a real day-end estimate.
export function bookSummary(
  world: World,
  player: Entity,
): BooksSummary {
  const wallet = player.get(Money)
  const fund = wallet?.amount ?? 0
  const ownedBuildings = playerOwnedBuildings(world, player)
  let revenue = 0
  let salaries = 0
  let maintenance = 0
  const revenueByFac: { label: string; amount: number }[] = []
  const expenseByFac: { label: string; amount: number }[] = []

  for (const b of ownedBuildings) {
    const fac = b.get(Facility)
    const bld = b.get(Building)!
    if (!fac) continue
    const facMaint = facilityMaintenancePerDay(bld.typeId)
    revenue += fac.revenueAcc
    salaries += fac.salariesAcc
    maintenance += facMaint
    if (fac.revenueAcc > 0) revenueByFac.push({ label: bld.label, amount: fac.revenueAcc })
    const facExpense = fac.salariesAcc + facMaint
    if (facExpense > 0) expenseByFac.push({ label: bld.label, amount: facExpense })
  }

  revenueByFac.sort((a, b) => b.amount - a.amount)
  expenseByFac.sort((a, b) => b.amount - a.amount)

  return {
    fund,
    todayRevenue: revenue,
    todaySalaries: salaries,
    todayMaintenance: maintenance,
    todayNet: revenue - salaries - maintenance,
    topRevenue: revenueByFac.slice(0, 3),
    topExpense: expenseByFac.slice(0, 3),
  }
}

export interface SidewaysReport {
  insolventFacilities: { label: string; days: number; closed: boolean }[]
  vacantStations: { label: string; jobTitle: string }[]
  unhousedCount: number
  unhousedNames: string[]
}

// "Has anything gone sideways?" Surfaces the day's warning loop the
// player might have missed: insolvent facilities, unstaffed job sites,
// members complaining about beds. Names cap at 3 each so the summary
// stays one short reply.
export function sidewaysReport(
  world: World,
  player: Entity,
): SidewaysReport {
  const insolventFacilities: SidewaysReport['insolventFacilities'] = []
  for (const b of playerOwnedBuildings(world, player)) {
    const fac = b.get(Facility)
    const bld = b.get(Building)!
    if (!fac) continue
    if (fac.insolventDays > 0 || fac.closedSinceDay > 0) {
      insolventFacilities.push({
        label: bld.label,
        days: fac.insolventDays,
        closed: fac.closedSinceDay > 0,
      })
    }
  }

  const vacantStations: SidewaysReport['vacantStations'] = []
  for (const { ws, building } of playerOwnedWorkstations(world, player)) {
    if (ws.get(Workstation)!.occupant !== null) continue
    const spec = getJobSpec(ws.get(Workstation)!.specId)
    vacantStations.push({
      label: building.get(Building)?.label ?? '设施',
      jobTitle: spec?.jobTitle ?? '工位',
    })
  }

  const unhoused = unhousedPlayerFactionMembers(world, player)

  return {
    insolventFacilities,
    vacantStations,
    unhousedCount: unhoused.length,
    unhousedNames: unhoused.slice(0, 3).map(memberDisplayName),
  }
}

// Building-scoped variant of assignIdleMembers — fills only vacancies
// inside `building` (the player-owned facility the manage cell is
// linked to). Mirrors the global variant's mutation discipline.
export function assignIdleMembersToBuilding(
  world: World,
  player: Entity,
  building: Entity,
): AssignmentSummary {
  const idle = idlePlayerFactionMembers(world, player)
  const vacancies = vacantPlayerOwnedWorkstations(world, player)
    .filter((v) => v.building === building)

  idle.sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
  vacancies.sort((a, b) => keyOf(a.ws).localeCompare(keyOf(b.ws)))

  let assigned = 0
  for (const member of idle) {
    const slot = vacancies.findIndex(({ ws }) => couldFillStation(member, ws))
    if (slot < 0) continue
    const { ws } = vacancies[slot]
    const cur = ws.get(Workstation)!
    if (cur.occupant !== null) continue
    clearMemberJob(member)
    ws.set(Workstation, { ...cur, occupant: member })
    member.set(Job, { workstation: ws, unemployedSinceMs: 0 })
    vacancies.splice(slot, 1)
    assigned += 1
  }

  const label = building.get(Building)?.label ?? '设施'
  return {
    assigned,
    unassigned: idle.length - assigned,
    perFacility: assigned > 0 ? [{ label, count: assigned }] : [],
  }
}

// Read-mostly inventory of workstations inside a single owned facility.
// Used by ManageFacilityDialog to render the local roster — vacant seats
// surface install verbs, occupied seats surface the worker's name.
export interface FacilityRosterEntry {
  ws: Entity
  jobTitle: string
  occupant: Entity | null
  occupantName: string | null
}

export function facilityRoster(
  world: World,
  player: Entity,
  building: Entity,
): FacilityRosterEntry[] {
  const out: FacilityRosterEntry[] = []
  for (const { ws, building: b } of playerOwnedWorkstations(world, player)) {
    if (b !== building) continue
    const w = ws.get(Workstation)!
    const spec = getJobSpec(w.specId)
    out.push({
      ws,
      jobTitle: spec?.jobTitle ?? '工位',
      occupant: w.occupant,
      occupantName: w.occupant ? memberDisplayName(w.occupant) : null,
    })
  }
  return out.sort((a, b) => keyOf(a.ws).localeCompare(keyOf(b.ws)))
}

// Population breakdown for the conversation header. Used by both the
// roster verb and the books readout.
export interface FactionStatus {
  memberCount: number
  facilityCount: number
  bedCount: number
  unhousedCount: number
}

export function factionStatus(world: World, player: Entity): FactionStatus {
  const members = playerFactionMembers(world, player)
  const buildings = playerOwnedBuildings(world, player)
  let bedCount = 0
  for (const b of buildings) {
    for (const _bed of bedsInsideBuilding(world, b)) bedCount += 1
  }
  return {
    memberCount: members.length,
    facilityCount: buildings.length,
    bedCount,
    unhousedCount: unhousedPlayerFactionMembers(world, player).length,
  }
}

// Resolve the player-faction's secretary entity (the NPC currently
// occupying any 'secretary' workstation in a player-owned faction office).
// Returns null when no office is owned or the seat is vacant. Multiple
// offices return the first encountered — the caller doesn't usually care.
export function findSecretary(world: World, player: Entity): Entity | null {
  for (const { ws, building } of playerOwnedWorkstations(world, player)) {
    const w = ws.get(Workstation)!
    if (w.specId !== 'secretary') continue
    if (building.get(Building)!.typeId !== 'factionOffice') continue
    if (w.occupant) return w.occupant
  }
  return null
}

// Used by the SecretaryDialog hire-list. Civilians not currently working
// any station, sorted by entity-key for determinism.
export function eligibleSecretaryHires(world: World): Entity[] {
  const out: Entity[] = []
  for (const c of world.query(Character, EntityKey)) {
    const job = c.get(Job)
    if (job?.workstation) continue
    out.push(c)
  }
  out.sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
  return out
}

// Helper used by SecretaryDialog when the player picks a civilian: clears
// any prior occupant + writes the chosen NPC into the secretary station.
export function installSecretary(
  ws: Entity,
  hire: Entity,
): boolean {
  const cur = ws.get(Workstation)
  if (!cur) return false
  if (cur.specId !== 'secretary') return false
  if (cur.occupant !== null && cur.occupant !== hire) return false
  clearMemberJob(hire)
  ws.set(Workstation, { ...cur, occupant: hire })
  hire.set(Job, { workstation: ws, unemployedSinceMs: 0 })
  return true
}

export function findOwnedFactionOfficeStation(
  world: World,
  player: Entity,
): Entity | null {
  for (const { ws, building } of playerOwnedWorkstations(world, player)) {
    const w = ws.get(Workstation)!
    if (w.specId !== 'secretary') continue
    if (building.get(Building)!.typeId !== 'factionOffice') continue
    return ws
  }
  return null
}

// Resolve the building containing a workstation — used by the dialog when
// it needs to show "this is your faction office at X" without re-walking
// the player-owned buildings list.
export function buildingForStation(
  world: World,
  ws: Entity,
): Entity | null {
  const player = findPlayer(world)
  if (player) {
    for (const { ws: w, building } of playerOwnedWorkstations(world, player)) {
      if (w === ws) return building
    }
  }
  // Pre-purchase: the desk renders before the player owns the building.
  // Fall through with a generic position-bounds scan so the dialog can
  // still show the label / close cleanly when the player buys.
  const wsPos = ws.get(Position)
  if (!wsPos) return null
  for (const b of world.query(Building)) {
    const bld = b.get(Building)!
    if (wsPos.x < bld.x || wsPos.x >= bld.x + bld.w) continue
    if (wsPos.y < bld.y || wsPos.y >= bld.y + bld.h) continue
    return b
  }
  return null
}

function keyOf(e: Entity): string {
  return e.get(EntityKey)?.key ?? `e${e.id()}`
}

// Walk every Bed and yield the ones whose Position falls inside `building`.
// Used by factionStatus() to count beds without re-importing the player-
// faction helpers (which return a flat list, not by-building).
function* bedsInsideBuilding(world: World, building: Entity) {
  const bld = building.get(Building)!
  for (const bed of world.query(Bed, Position)) {
    const p = bed.get(Position)!
    if (p.x < bld.x || p.x >= bld.x + bld.w) continue
    if (p.y < bld.y || p.y >= bld.y + bld.h) continue
    yield bed
  }
}
