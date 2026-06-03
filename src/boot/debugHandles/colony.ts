// Phase 6.3.B — colony economics debug handles.
// Phase 6.3.C — extended with construction, charter, and establishment-package handles.
// Phase 6.3.D — extended with admin-load, officer assignment, and detention handles.
// Phase 6.3.E — extended with colony threat state + threat system trigger handles.
// Exposes per-colony state for deterministic smoke tests without going
// through the UI. All handles are gated behind DEV mode in bootProd.tsx.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import {
  getColonyEconomics, setColonyEconomics,
  addColonyWarehouseItem, isPlayerColony,
  claimColony, getColonyRecord,
  addConstructionJob, getConstructionJobs, getAllConstructionJobEntries,
  getBuildPathState, setBuildPathState,
  assignColonyRole, getColonyRole, getDetentionOccupants, getDetentionCapacity,
  getColonyThreatState, setColonyThreatState,
  type WarehouseItem,
  type ConstructionJob,
  type ColonyRole,
  type ColonyThreatState,
} from '../../sim/colony'
import { colonyEconomicsSystem, colonyResupplyFromHangar } from '../../systems/colonyEconomics'
import { colonyConstructionSystem, fireConstructionInterrupt } from '../../systems/colonyConstruction'
import { colonyThreatsSystem, computeGarrisonStrength } from '../../systems/colonyThreats'
import { computeAdminLoadStatus, computeAdminCapacity } from '../../systems/colonyAdmin'
import { routeBrigOverflowToColonyDetention } from '../../systems/colonyDetention'
import { useBrig } from '../../sim/brig'
import type { PrisonerRecord } from '../../sim/brig'
import { gameDayNumber, useClock } from '../../sim/clock'
import { fleetConfig, recruitmentConfig, colonyConfig } from '../../config'
import { getPrimaryDockScene } from '../../data/pois'
import { getWorld, SCENE_IDS } from '../../ecs/world'
import { Building, IsPlayer, Reputation } from '../../ecs/traits'
import type { FactionId } from '../../data/factions'
import { buildingTypes } from '../../data/buildingTypes'

export interface ColonyEconomicsSnapshot {
  poiId: string
  stabilityScore: number
  accumulatedIncome: number
  warehouseContents: WarehouseItem[]
  lastRolloverDay: number
}

registerDebugHandle('colonyEconomicsSnapshot', (poiId: string): ColonyEconomicsSnapshot | null => {
  if (!isPlayerColony(poiId)) return null
  const econ = getColonyEconomics(poiId)
  if (!econ) return null
  return { poiId, ...econ }
})

interface RolloverResult {
  day: number
  coloniesProcessed: number
  totalIncomeCredit: number
}

registerDebugHandle('forceColonyEconomics', (gameDay?: number): RolloverResult => {
  const day = gameDay ?? gameDayNumber(useClock.getState().gameDate)
  const r = colonyEconomicsSystem(day)
  return { day, ...r }
})

// Reset the lastRolloverDay guard so a forced rollover fires even if the
// same day was already processed. Smoke tests that need multiple rollovers
// within one clock-day use this between calls to forceColonyEconomics.
registerDebugHandle('colonyResetRolloverDay', (poiId: string): { ok: boolean } => {
  const econ = getColonyEconomics(poiId)
  if (!econ) return { ok: false }
  setColonyEconomics(poiId, { ...econ, lastRolloverDay: 0 })
  return { ok: true }
})

interface ResupplyResult {
  ok: boolean
  unitsTransferred: number
  creditCharged: number
  aeEquivalentCost: number
  reason?: string
}

// Transfer supply or fuel from the colony's hangar reserve to a notional
// account. Returns how much was charged vs. the AE dealer price for the
// same quantity — the smoke test asserts creditCharged < aeEquivalentCost.
registerDebugHandle(
  'colonyResupply',
  (poiId: string, kind: 'supply' | 'fuel', qty: number): ResupplyResult => {
    const unitPrice = kind === 'supply' ? fleetConfig.supplyPricePerUnit : fleetConfig.fuelPricePerUnit
    const r = colonyResupplyFromHangar(poiId, kind, qty)
    return {
      ...r,
      aeEquivalentCost: unitPrice * qty,
    }
  },
)

interface StoreItemResult {
  ok: boolean
  reason?: string
}

registerDebugHandle(
  'colonyStoreItem',
  (poiId: string, item: WarehouseItem): StoreItemResult => {
    if (!isPlayerColony(poiId)) return { ok: false, reason: 'not a player colony' }
    addColonyWarehouseItem(poiId, item)
    return { ok: true }
  },
)

// Preview the effective hire terms that talkHire would apply when in the
// given colony — lets the smoke test verify the discount + loyalty bonus
// without driving the dialogue UI.
interface HirePreviewResult {
  inColony: boolean
  standardSigningBonus: number
  effectiveSigningBonus: number
  baseOpinionBonusOnAccept: number
  colonyOpinionBonusOnAccept: number
}

registerDebugHandle('colonyHirePreview', (poiId: string): HirePreviewResult => {
  const inColony = isPlayerColony(poiId)
  const standardBonus = recruitmentConfig.talkVerbHire.signingBonus
  const effectiveBonus = inColony
    ? Math.round(standardBonus * (1 - colonyConfig.recruitment.colonySigningFeeDiscount))
    : standardBonus
  const baseOpinionBonus = 10
  return {
    inColony,
    standardSigningBonus: standardBonus,
    effectiveSigningBonus: effectiveBonus,
    baseOpinionBonusOnAccept: baseOpinionBonus,
    colonyOpinionBonusOnAccept: inColony
      ? baseOpinionBonus + colonyConfig.recruitment.colonyLoyaltyBonus
      : baseOpinionBonus,
  }
})

// ── Phase 6.3.C — build-path debug handles ──────────────────────────────────

interface CharterResult {
  ok: boolean
  charterGranted?: boolean
  pirateAttention?: boolean
  reason?: string
}

// Diegetic charter gate — reads the player's standing with the faction
// from the live Reputation trait (set in-game / via setPlayerStat) rather
// than taking rep as a test parameter. The player roams between scene
// worlds, so scan SCENE_IDS for the IsPlayer entity.
function playerReputation(faction: string): number {
  for (const sceneId of SCENE_IDS) {
    const p = getWorld(sceneId).queryFirst(IsPlayer)
    if (!p) continue
    const r = p.get(Reputation)
    return r ? (r.rep[faction as FactionId] ?? 0) : 0
  }
  return 0
}

registerDebugHandle(
  'colonyGrantCharter',
  (faction: string): CharterResult => {
    const { repGate, factions } = colonyConfig.charter
    if (!factions.includes(faction)) {
      return { ok: false, reason: 'unknown_faction' }
    }
    if (playerReputation(faction) < repGate) {
      return { ok: false, reason: 'rep_too_low', charterGranted: false }
    }
    setBuildPathState({ charterGranted: true, charterFaction: faction })
    return { ok: true, charterGranted: true, pirateAttention: false }
  },
)

interface PackageResult {
  ok: boolean
  cargoId?: string
  reason?: string
}

registerDebugHandle('colonyBuyEstablishmentPackage', (): PackageResult => {
  setBuildPathState({ hasEstablishmentPackage: true })
  return { ok: true, cargoId: colonyConfig.establishmentPackage.cargoId }
})

interface DropPackageResult {
  ok: boolean
  sceneId?: string
  reason?: string
}

registerDebugHandle('colonyDropPackage', (poiId: string): DropPackageResult => {
  const state = getBuildPathState()
  if (!state.hasEstablishmentPackage) return { ok: false, reason: 'no_establishment_package' }
  setBuildPathState({ hasEstablishmentPackage: false })
  claimColony(poiId, null)
  const sceneId = getPrimaryDockScene(poiId)
  if (!sceneId) return { ok: false, reason: 'no_scene_for_poi' }
  return { ok: true, sceneId }
})

interface AuthorizeFacilityResult {
  ok: boolean
  jobId?: string
  reason?: string
}

let _jobCounter = 0

registerDebugHandle(
  'colonyAuthorizeFacility',
  (poiId: string, facilityTypeId: string): AuthorizeFacilityResult => {
    if (!isPlayerColony(poiId)) return { ok: false, reason: 'not_a_player_colony' }
    const durationDays = colonyConfig.construction.durationDays[facilityTypeId]
    if (durationDays === undefined) return { ok: false, reason: 'unknown_facility_type' }
    _jobCounter += 1
    const jobId = `job-${poiId}-${facilityTypeId}-${_jobCounter}`
    const currentDay = gameDayNumber(useClock.getState().gameDate)
    const job: ConstructionJob = {
      id: jobId,
      poiId,
      facilityTypeId,
      authorizedDay: currentDay,
      durationDays,
      status: 'inProgress',
    }
    addConstructionJob(job)
    return { ok: true, jobId }
  },
)

interface ConstructionSnapshot {
  poiId: string
  jobs: ConstructionJob[]
}

registerDebugHandle('colonyConstructionSnapshot', (poiId: string): ConstructionSnapshot | null => {
  if (!isPlayerColony(poiId)) return null
  return { poiId, jobs: getConstructionJobs(poiId) }
})

interface ForceConstructionResult {
  day: number
  coloniesProcessed: number
  jobsAdvanced: number
  jobsCompleted: number
  interruptsTriggered: number
}

registerDebugHandle('forceColonyConstruction', (gameDay?: number): ForceConstructionResult => {
  const day = gameDay ?? gameDayNumber(useClock.getState().gameDate)
  const r = colonyConstructionSystem(day)
  return { day, ...r }
})

registerDebugHandle('colonyFacilityRoster', (poiId: string): string[] => {
  const sceneId = getPrimaryDockScene(poiId)
  if (!sceneId) return []
  const w = getWorld(sceneId)
  const roster: string[] = []
  for (const bld of w.query(Building)) {
    const typeId = bld.get(Building)!.typeId
    if (typeId) roster.push(typeId)
  }
  return roster
})

registerDebugHandle('colonyOnlyFacilityTypes', (): string[] => {
  return Object.keys(buildingTypes).filter((id) => buildingTypes[id].colonyOnly === true)
})

interface TriggerInterruptResult {
  ok: boolean
  reason: string
}

registerDebugHandle('colonyTriggerInterrupt', (poiId: string): TriggerInterruptResult => {
  if (!isPlayerColony(poiId)) return { ok: false, reason: 'not_a_player_colony' }
  const jobs = getConstructionJobs(poiId)
  const hasActive = jobs.some((j) => j.status === 'inProgress')
  if (!hasActive) return { ok: false, reason: 'no_active_construction' }
  const reason = '施工意外：工人受伤，暂停快进'
  fireConstructionInterrupt(reason)
  return { ok: true, reason }
})

registerDebugHandle('colonyGetBuildPathState', (): ReturnType<typeof getBuildPathState> => {
  return getBuildPathState()
})

registerDebugHandle('getSpeed', (): number => {
  return useClock.getState().speed
})

registerDebugHandle('colonyGetAllConstructionJobs', (): Array<{ poiId: string; jobs: ConstructionJob[] }> => {
  return getAllConstructionJobEntries()
})

// ── Phase 6.3.D — admin-load + officer assignment + detention handles ────────

interface AssignRoleResult {
  ok: boolean
  poiId: string
  role: ColonyRole
  entityKey: string
  reason?: string
}

registerDebugHandle(
  'colonyAssignRole',
  (poiId: string, role: ColonyRole, entityKey: string): AssignRoleResult => {
    if (!isPlayerColony(poiId)) return { ok: false, poiId, role, entityKey, reason: 'not_a_player_colony' }
    const ok = assignColonyRole(poiId, role, entityKey)
    return { ok, poiId, role, entityKey }
  },
)

registerDebugHandle(
  'colonyGetRole',
  (poiId: string, role: ColonyRole): string => getColonyRole(poiId, role),
)

interface AdminLoadSnapshot {
  totalLoad: number
  capacity: number
  overloadAmount: number
  isOverloaded: boolean
  leadershipSkillStandin: string
}

registerDebugHandle('colonyGetAdminLoad', (): AdminLoadSnapshot => {
  const status = computeAdminLoadStatus()
  return {
    ...status,
    leadershipSkillStandin: colonyConfig.adminLoad.leadershipSkillStandin,
  }
})

registerDebugHandle('colonyGetAdminCapacity', (): number => computeAdminCapacity())

interface DetentionSnapshot {
  poiId: string
  occupants: string[]
  capacity: number
}

registerDebugHandle('colonyGetDetention', (poiId: string): DetentionSnapshot => ({
  poiId,
  occupants: getDetentionOccupants(poiId),
  capacity: getDetentionCapacity(),
}))

interface RoutingResult {
  routed: number
  detentionFull: boolean
}

registerDebugHandle(
  'colonyRouteBrigOverflow',
  (poiId: string): RoutingResult => routeBrigOverflowToColonyDetention(poiId),
)

// Force-add a prisoner to brig overflow (less-secure quarters) for testing the
// detention routing path without staging an actual over-capacity combat.
registerDebugHandle(
  'brigAddOverflow',
  (id: string, factionId: string = 'pirate'): { ok: boolean; id: string } => {
    const rec: PrisonerRecord = {
      id,
      nameZh: id,
      contextZh: '(overflow-test)',
      factionId,
      capturedAtMs: Date.now(),
      entityKey: id,
      provision: 100,
    }
    useBrig.getState().addToOverflow(rec)
    return { ok: true, id }
  },
)

registerDebugHandle('brigGetOverflow', (): PrisonerRecord[] => {
  return useBrig.getState().overflowPrisoners.slice()
})

// ── Phase 6.3.E — colony threat state + threat system handles ───────────────

interface ThreatStateSnapshot {
  poiId: string
  lastRaidAttemptDay: number
  collapseGraceStartDay: number
}

registerDebugHandle('colonyGetThreatState', (poiId: string): ThreatStateSnapshot | null => {
  if (!isPlayerColony(poiId)) return null
  const state = getColonyThreatState(poiId)
  return { poiId, ...state }
})

registerDebugHandle(
  'colonySetThreatState',
  (poiId: string, state: ColonyThreatState): { ok: boolean } => {
    if (!isPlayerColony(poiId)) return { ok: false }
    setColonyThreatState(poiId, state)
    return { ok: true }
  },
)

interface ForceThreatsResult {
  day: number
  coloniesProcessed: number
  raidsSpawned: number
  autoResolved: number
  collapseWarningsFired: number
  coloniesForfeited: number
}

registerDebugHandle('forceColonyThreats', (gameDay?: number): ForceThreatsResult => {
  const day = gameDay ?? gameDayNumber(useClock.getState().gameDate)
  const r = colonyThreatsSystem(day)
  return { day, ...r }
})

interface GarrisonSnapshot {
  poiId: string
  garrisonStrength: number
  autoResolveThreshold: number
  canAutoResolve: boolean
}

registerDebugHandle('colonyGetGarrisonStrength', (poiId: string): GarrisonSnapshot | null => {
  if (!isPlayerColony(poiId)) return null
  const rec = getColonyRecord(poiId)
  if (!rec) return null
  const sceneId = getPrimaryDockScene(poiId)
  if (!sceneId) return null
  const w = getWorld(sceneId)
  const garrisonStrength = computeGarrisonStrength(w, rec)
  const autoResolveThreshold = colonyConfig.threats.autoResolveGarrisonThreshold
  return {
    poiId,
    garrisonStrength,
    autoResolveThreshold,
    canAutoResolve: garrisonStrength >= autoResolveThreshold,
  }
})

interface ForceRaidResult {
  ok: boolean
  poiId: string
  autoResolved: boolean
  garrisonStrength: number
  reason?: string
}

// Deterministic handle: directly trigger a pirate raid on the colony
// without a random roll. Used by smoke tests to verify raid consequences
// (cooldown tracking, auto-resolve) without depending on RNG outcomes.
registerDebugHandle(
  'colonyForceRaid',
  (poiId: string, gameDay: number): ForceRaidResult => {
    if (!isPlayerColony(poiId)) return { ok: false, poiId, autoResolved: false, garrisonStrength: 0, reason: 'not_a_player_colony' }
    const rec = getColonyRecord(poiId)
    if (!rec) return { ok: false, poiId, autoResolved: false, garrisonStrength: 0, reason: 'no_record' }
    const sceneId = getPrimaryDockScene(poiId)
    if (!sceneId) return { ok: false, poiId, autoResolved: false, garrisonStrength: 0, reason: 'no_scene' }
    const w = getWorld(sceneId)
    const garrisonStrength = computeGarrisonStrength(w, rec)
    const cfg = colonyConfig.threats
    const autoResolved = garrisonStrength >= cfg.autoResolveGarrisonThreshold

    // Record the raid on the threat state.
    const threat = getColonyThreatState(poiId)
    setColonyThreatState(poiId, { ...threat, lastRaidAttemptDay: gameDay })

    return { ok: true, poiId, autoResolved, garrisonStrength }
  },
)
