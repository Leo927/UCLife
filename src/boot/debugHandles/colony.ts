// Phase 6.3.B — colony economics debug handles.
// Phase 6.3.C — extended with construction, charter, and establishment-package handles.
// Exposes per-colony state for deterministic smoke tests without going
// through the UI. All handles are gated behind DEV mode in bootProd.tsx.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import {
  getColonyEconomics, setColonyEconomics,
  addColonyWarehouseItem, isPlayerColony,
  claimColony,
  addConstructionJob, getConstructionJobs, getAllConstructionJobEntries,
  getBuildPathState, setBuildPathState,
  type WarehouseItem,
  type ConstructionJob,
} from '../../sim/colony'
import { colonyEconomicsSystem, colonyResupplyFromHangar } from '../../systems/colonyEconomics'
import { colonyConstructionSystem, fireConstructionInterrupt } from '../../systems/colonyConstruction'
import { gameDayNumber, useClock } from '../../sim/clock'
import { fleetConfig, recruitmentConfig, colonyConfig } from '../../config'
import { getPrimaryDockScene } from '../../data/pois'
import { getWorld } from '../../ecs/world'
import { Building } from '../../ecs/traits'
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

registerDebugHandle(
  'colonyGrantCharter',
  (faction: string, playerRep: number): CharterResult => {
    const { repGate, factions } = colonyConfig.charter
    if (!factions.includes(faction)) {
      return { ok: false, reason: 'unknown_faction' }
    }
    if (playerRep < repGate) {
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
