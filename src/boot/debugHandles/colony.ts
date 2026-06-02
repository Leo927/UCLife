// Phase 6.3.B — colony economics debug handles.
// Phase 6.3.C — extended with build-path, charter, package, and construction handles.
// All handles are gated behind DEV mode in bootProd.tsx.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import {
  getColonyEconomics, setColonyEconomics,
  addColonyWarehouseItem, isPlayerColony, claimColony,
  getBuildPathState, setBuildPathState,
  addConstructionJob, getConstructionJobs,
  getAllConstructionJobEntries,
  type WarehouseItem, type ConstructionJob,
} from '../../sim/colony'
import { colonyEconomicsSystem, colonyResupplyFromHangar } from '../../systems/colonyEconomics'
import { colonyConstructionSystem } from '../../systems/colonyConstruction'
import { gameDayNumber, useClock } from '../../sim/clock'
import { fleetConfig, recruitmentConfig, colonyConfig } from '../../config'
import { buildingTypes } from '../../data/buildingTypes'
import { SCENE_IDS, getWorld } from '../../ecs/world'
import { IsPlayer, Reputation, Building } from '../../ecs/traits'
import { emitSim } from '../../sim/events'
import { getPrimaryDockScene } from '../../data/pois'

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

// ── Phase 6.3.C — build-path debug handles ─────────────────────────────

interface CharterResult {
  ok: boolean
  reason?: string
  fee?: number
}

// File a charter with the given faction's permits office.
// Returns ok=false with reason='rep_too_low' when the player's rep is
// below the configured threshold.
registerDebugHandle('colonyGrantCharter', (factionId: string): CharterResult => {
  const cfg = colonyConfig.charter
  if (!cfg.factions.includes(factionId)) {
    return { ok: false, reason: 'faction_not_eligible' }
  }
  // Check player reputation.
  let rep = 0
  for (const sceneId of SCENE_IDS) {
    const p = getWorld(sceneId).queryFirst(IsPlayer)
    if (p) {
      const r = p.get(Reputation)
      rep = r ? (r.rep[factionId as keyof typeof r.rep] ?? 0) : 0
      break
    }
  }
  if (rep < cfg.minFactionRep) {
    return { ok: false, reason: 'rep_too_low', fee: cfg.fee }
  }
  setBuildPathState({ ...getBuildPathState(), charterGranted: true, charterFaction: factionId })
  return { ok: true, fee: cfg.fee }
})

interface PackageResult {
  ok: boolean
  cost?: number
  reason?: string
}

// Purchase an establishment package (marks it as in fleet).
registerDebugHandle('colonyBuyEstablishmentPackage', (): PackageResult => {
  const state = getBuildPathState()
  if (state.packageInFleet) return { ok: false, reason: 'already_in_fleet' }
  setBuildPathState({ ...state, packageInFleet: true })
  return { ok: true, cost: colonyConfig.establishmentPackage.cost }
})

interface DropPackageResult {
  ok: boolean
  colonyClaimed?: boolean
  reason?: string
}

// Drop the establishment package at the given POI, claiming it as a colony.
// Requires the package to be in fleet.
registerDebugHandle('colonyDropPackage', (poiId: string): DropPackageResult => {
  const state = getBuildPathState()
  if (!state.packageInFleet) return { ok: false, reason: 'no_package_in_fleet' }
  if (isPlayerColony(poiId)) return { ok: false, reason: 'already_owned' }
  claimColony(poiId, null)
  setBuildPathState({ ...state, packageInFleet: false })
  return { ok: true, colonyClaimed: true }
})

interface AuthorizeFacilityResult {
  ok: boolean
  jobId?: string
  daysRequired?: number
  reason?: string
}

// Authorize construction of a facility at a player-owned colony.
registerDebugHandle(
  'colonyAuthorizeFacility',
  (poiId: string, facilityType: string): AuthorizeFacilityResult => {
    if (!isPlayerColony(poiId)) return { ok: false, reason: 'not_player_colony' }
    const btype = buildingTypes[facilityType]
    if (!btype) return { ok: false, reason: 'unknown_facility_type' }
    if (!btype.colonyOnly) return { ok: false, reason: 'not_colony_only_type' }
    const days = colonyConfig.construction.daysPerType[facilityType] ?? 1
    const job = addConstructionJob(poiId, facilityType, days)
    return { ok: true, jobId: job.jobId, daysRequired: days }
  },
)

interface ConstructionSnapshot {
  poiId: string
  jobs: ConstructionJob[]
  inProgressCount: number
  completedCount: number
}

// Get construction state for a specific colony.
registerDebugHandle(
  'colonyConstructionSnapshot',
  (poiId: string): ConstructionSnapshot | null => {
    if (!isPlayerColony(poiId)) return null
    const jobs = getConstructionJobs(poiId)
    return {
      poiId,
      jobs,
      inProgressCount: jobs.filter((j) => j.status === 'in_progress').length,
      completedCount: jobs.filter((j) => j.status === 'completed').length,
    }
  },
)

interface ForceConstructionResult {
  coloniesProcessed: number
  jobsAdvanced: number
  jobsCompleted: number
  interruptsFired: number
}

// Force-advance construction by one day across all colonies.
registerDebugHandle('forceColonyConstruction', (gameDay?: number): ForceConstructionResult => {
  const day = gameDay ?? gameDayNumber(useClock.getState().gameDate)
  return colonyConstructionSystem(day)
})

// Get the current sim speed (0 = paused).
registerDebugHandle('getSpeed', (): number => {
  return useClock.getState().speed
})

interface FacilityRosterResult {
  poiId: string
  buildings: Array<{ typeId: string; key: string }>
}

// Get the full building roster in the colony's primary dock scene.
registerDebugHandle(
  'colonyFacilityRoster',
  (poiId: string): FacilityRosterResult | null => {
    const sceneId = getPrimaryDockScene(poiId)
    if (!sceneId) return null
    const w = getWorld(sceneId)
    const buildings: Array<{ typeId: string; key: string }> = []
    for (const ent of w.query(Building)) {
      const typeId = ent.get(Building)!.typeId
      if (typeId === '') continue
      buildings.push({ typeId, key: '' })
    }
    return { poiId, buildings }
  },
)

// Return all building type ids that are marked colonyOnly: true.
registerDebugHandle('colonyOnlyFacilityTypes', (): string[] => {
  return Object.entries(buildingTypes)
    .filter(([, bt]) => bt.colonyOnly === true)
    .map(([id]) => id)
})

interface TriggerInterruptResult {
  reason: string
}

// Force-fire a construction interrupt (breaks hyperspeed, sets speed=0).
// In production the loop reads pendingHyperspeedBreak on the next RAF frame;
// in test mode the loop is stopped, so we apply the effect directly via setSpeed.
registerDebugHandle('colonyTriggerInterrupt', (): TriggerInterruptResult => {
  const reason = '施工中断（调试触发）'
  emitSim('hyperspeed:break', { reason })
  emitSim('log', { textZh: reason, atMs: useClock.getState().gameDate.getTime() })
  useClock.getState().setSpeed(0)
  return { reason }
})

// Return all in-progress construction jobs across all colonies.
registerDebugHandle('allConstructionJobs', (): Array<{ poiId: string; jobs: ConstructionJob[] }> => {
  return getAllConstructionJobEntries()
})

// Return the current build-path state.
registerDebugHandle('getBuildPathState', (): ReturnType<typeof getBuildPathState> => {
  return getBuildPathState()
})
