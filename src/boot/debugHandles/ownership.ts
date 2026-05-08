// Phase 5.5 ownership debug surface. Lets the smoke suite verify the
// faction-entity bootstrap, the per-building Owner default, the realtor
// listing pipeline (5.5.1), and the daily-economics rollover (5.5.2)
// without reaching into koota internals.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import { world, getWorld, getActiveSceneId } from '../../ecs/world'
import { Applicant, Building, Faction, Owner, IsPlayer, Money, EntityKey, Facility, Character, Workstation, Recruiter, Interactable, ManageCell, Position } from '../../ecs/traits'
import { gatherListings, buyFromState } from '../../systems/realtor'
import { dailyEconomicsSystem } from '../../systems/dailyEconomics'
import { housingPressureSystem } from '../../systems/housingPressure'
import { emitSim } from '../../sim/events'
import { useUI } from '../../ui/uiStore'
import {
  assignBeds, assignIdleMembers, assignIdleMembersToBuilding,
  bookSummary, factionStatus,
  findOwnedFactionOfficeStation, installSecretary, sidewaysReport,
  eligibleSecretaryHires,
} from '../../systems/secretaryRoster'
import { gameDayNumber, useClock } from '../../sim/clock'
import {
  debugSpawnApplicant, eligibleRecruiterHires, findOwnedRecruiterStation,
  installRecruiter, lobbyForStation, manualAcceptApplicant,
  recruitmentSystem, rejectApplicant,
} from '../../systems/recruitment'
import type { SkillId } from '../../character/skills'

interface OwnerSummary {
  kind: 'state' | 'faction' | 'character'
  factionId: string | null
}

interface OwnershipSnapshot {
  factions: { id: string; fund: number }[]
  buildingsByOwnerKind: Record<'state' | 'faction' | 'character' | 'untagged', number>
  buildingsByFaction: Record<string, number>
}

registerDebugHandle('ownershipSnapshot', (): OwnershipSnapshot => {
  const factions: OwnershipSnapshot['factions'] = []
  for (const e of world.query(Faction)) {
    const f = e.get(Faction)!
    factions.push({ id: f.id, fund: f.fund })
  }
  const byKind: OwnershipSnapshot['buildingsByOwnerKind'] = {
    state: 0, faction: 0, character: 0, untagged: 0,
  }
  const byFaction: Record<string, number> = {}
  for (const b of world.query(Building)) {
    const o = b.get(Owner)
    if (!o) { byKind.untagged += 1; continue }
    byKind[o.kind] += 1
    if (o.kind === 'faction' && o.entity) {
      const f = o.entity.get(Faction)
      if (f) byFaction[f.id] = (byFaction[f.id] ?? 0) + 1
    }
  }
  return { factions, buildingsByOwnerKind: byKind, buildingsByFaction: byFaction }
})

registerDebugHandle('ownerOf', (label: string): OwnerSummary | null => {
  for (const b of world.query(Building)) {
    if (b.get(Building)!.label !== label) continue
    const o = b.get(Owner)
    if (!o) return null
    if (o.kind === 'faction' && o.entity) {
      const f = o.entity.get(Faction)
      return { kind: 'faction', factionId: f?.id ?? null }
    }
    return { kind: o.kind, factionId: null }
  }
  return null
})

interface ListingDebug {
  buildingKey: string
  typeId: string
  category: string
  ownerKind: string
  sellerName: string | null
  askingPrice: number | null
}

registerDebugHandle('realtorListings', (): ListingDebug[] => {
  return gatherListings(world).map((l) => ({
    buildingKey: l.buildingKey,
    typeId: l.typeId,
    category: l.category,
    ownerKind: l.ownerKind,
    sellerName: l.seller?.name ?? null,
    askingPrice: l.askingPrice,
  }))
})

interface BuyResult {
  ok: boolean
  paid: number | null
  reason?: string
}

interface FacilitySnapshot {
  buildingKey: string
  typeId: string
  ownerKind: string
  ownerName: string | null
  revenueAcc: number
  salariesAcc: number
  insolventDays: number
  closedSinceDay: number
  closedReason: string | null
  lastRolloverDay: number
}

// Per-building Facility state. Lets the smoke suite verify economic
// rollovers + insolvency transitions without parsing toasts. Optional
// `buildingKey` filter narrows the result to a single facility.
registerDebugHandle('facilitySnapshot', (buildingKey?: string): FacilitySnapshot[] => {
  const out: FacilitySnapshot[] = []
  for (const b of world.query(Building, Owner, Facility, EntityKey)) {
    const key = b.get(EntityKey)!.key
    if (buildingKey && key !== buildingKey) continue
    const o = b.get(Owner)!
    const fac = b.get(Facility)!
    const bld = b.get(Building)!
    let ownerName: string | null = null
    if (o.kind === 'character' && o.entity) {
      ownerName = o.entity.get(Character)?.name ?? null
    } else if (o.kind === 'faction' && o.entity) {
      ownerName = o.entity.get(Faction)?.id ?? null
    }
    out.push({
      buildingKey: key,
      typeId: bld.typeId,
      ownerKind: o.kind,
      ownerName,
      revenueAcc: fac.revenueAcc,
      salariesAcc: fac.salariesAcc,
      insolventDays: fac.insolventDays,
      closedSinceDay: fac.closedSinceDay,
      closedReason: fac.closedReason,
      lastRolloverDay: fac.lastRolloverDay,
    })
  }
  return out
})

interface FacilityForceState {
  // Mutate the named facility's bookkeeping. Smoke uses this to drop
  // owner fund / pump salariesAcc into insolvency without waiting for
  // a real shift to fire.
  buildingKey: string
  revenueAcc?: number
  salariesAcc?: number
  ownerFund?: number
}

registerDebugHandle('facilityForce', (state: FacilityForceState): boolean => {
  for (const b of world.query(Building, Owner, Facility, EntityKey)) {
    if (b.get(EntityKey)!.key !== state.buildingKey) continue
    const fac = b.get(Facility)!
    b.set(Facility, {
      ...fac,
      revenueAcc: state.revenueAcc ?? fac.revenueAcc,
      salariesAcc: state.salariesAcc ?? fac.salariesAcc,
    })
    if (state.ownerFund !== undefined) {
      const o = b.get(Owner)!
      if (o.kind === 'character' && o.entity) {
        o.entity.set(Money, { amount: state.ownerFund })
      } else if (o.kind === 'faction' && o.entity) {
        const f = o.entity.get(Faction)
        if (f) o.entity.set(Faction, { ...f, fund: state.ownerFund })
      }
    }
    return true
  }
  return false
})

interface RolloverResult {
  day: number
  facilitiesProcessed: number
  foreclosed: number
  insolventStarted: number
  warnings: number
}

// Force a daily-economics rollover for the active scene at the given
// game-day. Useful for tests that don't want to advance the sim clock 24h.
registerDebugHandle('forceDailyEconomics', (gameDay?: number): RolloverResult => {
  const day = gameDay ?? gameDayNumber(useClock.getState().gameDate)
  const r = dailyEconomicsSystem(getWorld(getActiveSceneId()), day)
  return { day, ...r }
})

// Phase 5.5.3 — secretary delegate. Smoke test exercises the four verbs
// + the install-secretary flow without driving the modal directly.

registerDebugHandle('factionStatus', () => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return null
  return factionStatus(world, player)
})

registerDebugHandle('factionInstallSecretary', (): {
  ok: boolean
  reason?: string
  secretaryName?: string
} => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return { ok: false, reason: 'no player' }
  const ws = findOwnedFactionOfficeStation(world, player)
  if (!ws) return { ok: false, reason: 'no player-owned faction office' }
  if (ws.get(Workstation)!.occupant !== null) {
    const occ = ws.get(Workstation)!.occupant!
    return { ok: true, secretaryName: occ.get(Character)?.name ?? '已就职' }
  }
  const hires = eligibleSecretaryHires(world)
  const pick = hires[0]
  if (!pick) return { ok: false, reason: 'no eligible civilians' }
  if (!installSecretary(ws, pick, player)) return { ok: false, reason: 'install rejected' }
  return { ok: true, secretaryName: pick.get(Character)?.name ?? '未命名' }
})

registerDebugHandle('factionAssignRoster', () => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return null
  return assignIdleMembers(world, player)
})

registerDebugHandle('factionAssignBeds', () => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return null
  return assignBeds(world, player)
})

registerDebugHandle('factionBookSummary', () => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return null
  return bookSummary(world, player)
})

registerDebugHandle('factionSidewaysReport', () => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return null
  return sidewaysReport(world, player)
})

registerDebugHandle('forceHousingPressure', () => {
  return housingPressureSystem(world)
})

// Phase 5.5.4 — recruiter office smoke. Mirrors the secretary handles:
// install a recruiter, generate applicants, exercise the auto-accept
// + manual review verbs through __uclife__ rather than the modal.

registerDebugHandle('factionInstallRecruiter', (): {
  ok: boolean
  reason?: string
  recruiterName?: string
} => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return { ok: false, reason: 'no player' }
  const ws = findOwnedRecruiterStation(world, player)
  if (!ws) return { ok: false, reason: 'no player-owned recruit office' }
  if (ws.get(Workstation)!.occupant !== null) {
    const occ = ws.get(Workstation)!.occupant!
    return { ok: true, recruiterName: occ.get(Character)?.name ?? '已就职' }
  }
  const hires = eligibleRecruiterHires(world)
  const pick = hires[0]
  if (!pick) return { ok: false, reason: 'no eligible civilians' }
  if (!installRecruiter(ws, pick, player)) return { ok: false, reason: 'install rejected' }
  return { ok: true, recruiterName: pick.get(Character)?.name ?? '未命名' }
})

interface ApplicantSnapshot {
  name: string
  topSkillId: string
  topSkillLevel: number
  qualityScore: number
  summary: string
}

registerDebugHandle('recruiterLobby', (): ApplicantSnapshot[] => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return []
  const ws = findOwnedRecruiterStation(world, player)
  if (!ws) return []
  return lobbyForStation(world, ws).map(({ data }) => ({
    name: data.name,
    topSkillId: data.topSkillId,
    topSkillLevel: data.topSkillLevel,
    qualityScore: data.qualityScore,
    summary: data.summary,
  }))
})

registerDebugHandle('recruiterSpawnApplicant', (): { ok: boolean; reason?: string; key?: string } => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return { ok: false, reason: 'no player' }
  const ws = findOwnedRecruiterStation(world, player)
  if (!ws) return { ok: false, reason: 'no player-owned recruit office' }
  const ent = debugSpawnApplicant(world, ws)
  if (!ent) return { ok: false, reason: 'spawn failed' }
  return { ok: true, key: ent.get(EntityKey)?.key ?? '?' }
})

registerDebugHandle('recruiterSetCriteria', (
  skill: SkillId | null, minLevel: number, autoAccept: boolean,
): { ok: boolean; reason?: string } => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return { ok: false, reason: 'no player' }
  const ws = findOwnedRecruiterStation(world, player)
  if (!ws) return { ok: false, reason: 'no player-owned recruit office' }
  if (!ws.has(Recruiter)) return { ok: false, reason: 'no Recruiter trait' }
  const cur = ws.get(Recruiter)!
  ws.set(Recruiter, { ...cur, criteria: { skill, minLevel, autoAccept } })
  return { ok: true }
})

interface AcceptResult {
  ok: boolean
  reason?: string
  acceptedKey?: string
}

registerDebugHandle('recruiterAcceptFirst', (): AcceptResult => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return { ok: false, reason: 'no player' }
  const ws = findOwnedRecruiterStation(world, player)
  if (!ws) return { ok: false, reason: 'no player-owned recruit office' }
  const lobby = lobbyForStation(world, ws)
  if (lobby.length === 0) return { ok: false, reason: 'lobby empty' }
  const first = lobby[0].applicant
  const k = first.get(EntityKey)?.key ?? '?'
  if (!manualAcceptApplicant(world, first, player)) return { ok: false, reason: 'accept failed' }
  return { ok: true, acceptedKey: k }
})

registerDebugHandle('recruiterRejectFirst', (): AcceptResult => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return { ok: false, reason: 'no player' }
  const ws = findOwnedRecruiterStation(world, player)
  if (!ws) return { ok: false, reason: 'no player-owned recruit office' }
  const lobby = lobbyForStation(world, ws)
  if (lobby.length === 0) return { ok: false, reason: 'lobby empty' }
  const first = lobby[0].applicant
  const k = first.get(EntityKey)?.key ?? '?'
  if (!rejectApplicant(first)) return { ok: false, reason: 'reject failed' }
  return { ok: true, acceptedKey: k }
})

registerDebugHandle('forceRecruitment', (gameDay?: number) => {
  const day = gameDay ?? gameDayNumber(useClock.getState().gameDate)
  return { day, ...recruitmentSystem(world, day) }
})

// Used by the smoke to verify Applicant traits are wired through saves.
registerDebugHandle('countApplicants', (): number => {
  let n = 0
  for (const _e of world.query(Applicant)) n += 1
  return n
})

// Phase 5.5.4.5 — per-facility manage cell. The smoke verifies the cell
// is spawned for player-ownable types, that it is inert until the
// player owns the linked building, and that triggering it (simulating
// a walk-on) opens the manage dialog scoped to that facility.

interface ManageCellSummary {
  buildingKey: string
  buildingTypeId: string
  ownerKind: 'state' | 'faction' | 'character'
  ownedByPlayer: boolean
  x: number
  y: number
}

registerDebugHandle('listManageCells', (): ManageCellSummary[] => {
  const player = world.queryFirst(IsPlayer)
  const out: ManageCellSummary[] = []
  for (const cell of world.query(Interactable, ManageCell, Position)) {
    const it = cell.get(Interactable)!
    if (it.kind !== 'manage') continue
    const link = cell.get(ManageCell)!
    const building = link.building
    if (!building) continue
    const bld = building.get(Building)
    const o = building.get(Owner)
    if (!bld || !o) continue
    const key = building.get(EntityKey)?.key ?? '?'
    const p = cell.get(Position)!
    out.push({
      buildingKey: key,
      buildingTypeId: bld.typeId,
      ownerKind: o.kind,
      ownedByPlayer: !!player && o.kind === 'character' && o.entity === player,
      x: p.x, y: p.y,
    })
  }
  return out
})

interface ManageTriggerResult {
  ok: boolean
  reason?: string
  buildingKey?: string
}

registerDebugHandle('manageCellTrigger', (buildingKey: string): ManageTriggerResult => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return { ok: false, reason: 'no player' }
  for (const cell of world.query(Interactable, ManageCell)) {
    const it = cell.get(Interactable)!
    if (it.kind !== 'manage') continue
    const link = cell.get(ManageCell)!
    const building = link.building
    if (!building) continue
    if (building.get(EntityKey)?.key !== buildingKey) continue
    const o = building.get(Owner)
    if (!o || o.kind !== 'character' || o.entity !== player) {
      return { ok: false, reason: 'not owned by player', buildingKey }
    }
    emitSim('ui:open-manage', { building })
    return { ok: true, buildingKey }
  }
  return { ok: false, reason: 'manage cell not found', buildingKey }
})

registerDebugHandle('manageDialogState', (): {
  open: boolean
  buildingKey: string | null
} => {
  const b = useUI.getState().dialogManageBuilding
  if (!b) return { open: false, buildingKey: null }
  const key = b.get(EntityKey)?.key ?? null
  return { open: true, buildingKey: key }
})

registerDebugHandle('manageDialogClose', (): { ok: true } => {
  useUI.getState().setDialogManageBuilding(null)
  return { ok: true }
})

registerDebugHandle('manageAssignIdle', (buildingKey: string): {
  ok: boolean
  reason?: string
  assigned?: number
  unassigned?: number
} => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return { ok: false, reason: 'no player' }
  for (const b of world.query(Building, EntityKey)) {
    if (b.get(EntityKey)!.key !== buildingKey) continue
    const o = b.get(Owner)
    if (!o || o.kind !== 'character' || o.entity !== player) {
      return { ok: false, reason: 'not owned by player' }
    }
    const summary = assignIdleMembersToBuilding(world, player, b)
    return { ok: true, assigned: summary.assigned, unassigned: summary.unassigned }
  }
  return { ok: false, reason: 'building not found' }
})

registerDebugHandle('realtorBuy', (buildingKey: string): BuyResult => {
  const player = world.queryFirst(IsPlayer)
  if (!player) return { ok: false, paid: null, reason: 'no player' }
  for (const b of world.query(Building, EntityKey)) {
    if (b.get(EntityKey)!.key !== buildingKey) continue
    // Set wallet to a high number so the smoke test isn't gated on
    // debugCheats sequencing — this handle is a synthetic test hook.
    const cur = player.get(Money)?.amount ?? 0
    if (cur < 1_000_000) player.set(Money, { amount: 1_000_000 })
    const listings = gatherListings(world)
    const target = listings.find((l) => l.buildingKey === buildingKey)
    if (!target) return { ok: false, paid: null, reason: 'not listed' }
    if (target.ownerKind !== 'state') {
      return { ok: false, paid: null, reason: `not state-owned (${target.ownerKind})` }
    }
    const paid = buyFromState(player, target)
    if (paid === null) return { ok: false, paid: null, reason: 'buyFromState rejected' }
    return { ok: true, paid }
  }
  return { ok: false, paid: null, reason: 'building not found' }
})
