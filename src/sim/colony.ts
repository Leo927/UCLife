// Colony ownership registry — Phase 6.3.A.
// Phase 6.3.B extends with per-colony economics state.
// Phase 6.3.C extends with construction jobs, charter state, and establishment
// package tracking for the build-path acquisition arc.
// Phase 6.3.D extends with named-officer role assignments and colony detention.
// Phase 6.3.E extends with per-colony threat state (raid cooldown + collapse grace).
// Tracks which POIs the player-faction has claimed.
// Keyed by poiId; each record carries the entity key of the installed admin.
// State persists via src/boot/saveHandlers/colony.ts.

import { colonyConfig } from '../config/colony'

// Phase 6.3.D — named officer roles that can be filled on a colony.
export type ColonyRole = 'administrator' | 'leadEngineer' | 'garrisonCommander'

export interface ColonyRecord {
  poiId: string
  adminEntityKey: string | null
  // Phase 6.3.D — named-officer role assignments (EntityKey strings; '' = unassigned).
  administratorKey: string
  leadEngineerKey: string
  garrisonCommanderKey: string
  // Phase 6.3.D — EntityKey refs of prisoners held in colony detention.
  detentionOccupants: string[]
}

// Phase 6.3.B — per-item warehouse slot. 'ms' = mobile suit entity key,
// 'cargo' = cargo type id + quantity, 'parts' = parts id + quantity.
export interface WarehouseItem {
  kind: 'ms' | 'cargo' | 'parts'
  id: string
  qty: number
}

// Phase 6.3.B — economics state tracked per colony.
// Mutated by colonyEconomicsSystem on day:rollover.
export interface ColonyEconomicsState {
  stabilityScore: number
  accumulatedIncome: number
  warehouseContents: WarehouseItem[]
  lastRolloverDay: number
}

function freshEconomicsState(): ColonyEconomicsState {
  return {
    stabilityScore: 0,
    accumulatedIncome: 0,
    warehouseContents: [],
    lastRolloverDay: 0,
  }
}

const records = new Map<string, ColonyRecord>()
const economics = new Map<string, ColonyEconomicsState>()

function freshColonyRecord(poiId: string, adminEntityKey: string | null): ColonyRecord {
  return {
    poiId,
    adminEntityKey,
    administratorKey: '',
    leadEngineerKey: '',
    garrisonCommanderKey: '',
    detentionOccupants: [],
  }
}

export function claimColony(poiId: string, adminEntityKey: string | null): void {
  records.set(poiId, freshColonyRecord(poiId, adminEntityKey))
  if (!economics.has(poiId)) {
    economics.set(poiId, freshEconomicsState())
  }
  if (!threatStates.has(poiId)) {
    threatStates.set(poiId, freshThreatState())
  }
}

export function isPlayerColony(poiId: string): boolean {
  return records.has(poiId)
}

export function getColonyRecord(poiId: string): ColonyRecord | null {
  return records.get(poiId) ?? null
}

export function getAllColonyRecords(): ColonyRecord[] {
  return [...records.values()]
}

// Phase 6.3.B — economics accessors.

export function getColonyEconomics(poiId: string): ColonyEconomicsState | null {
  return economics.get(poiId) ?? null
}

export function setColonyEconomics(poiId: string, state: ColonyEconomicsState): void {
  economics.set(poiId, state)
}

export function addColonyWarehouseItem(poiId: string, item: WarehouseItem): void {
  const st = economics.get(poiId) ?? freshEconomicsState()
  const existing = st.warehouseContents.find((w) => w.kind === item.kind && w.id === item.id)
  if (existing) {
    existing.qty += item.qty
  } else {
    st.warehouseContents.push({ ...item })
  }
  economics.set(poiId, st)
}

export function getAllColonyEconomicsEntries(): Array<{ poiId: string; state: ColonyEconomicsState }> {
  return [...economics.entries()].map(([poiId, state]) => ({ poiId, state }))
}

// Phase 6.3.E — threat state accessors.

export function getColonyThreatState(poiId: string): ColonyThreatState {
  return threatStates.get(poiId) ?? freshThreatState()
}

export function setColonyThreatState(poiId: string, state: ColonyThreatState): void {
  threatStates.set(poiId, state)
}

export function getAllColonyThreatEntries(): Array<{ poiId: string; state: ColonyThreatState }> {
  return [...threatStates.entries()].map(([poiId, state]) => ({ poiId, state }))
}

// Phase 6.3.E — ownership forfeit. Removes the colony from the registry
// (records, economics, construction, threat state) and clears officer roles +
// detention occupants so no dangling EntityKey refs remain. Does NOT destroy
// ECS entities inside the colony scene — the scene stays up but the POI
// is no longer player-owned.
export function forfeitColony(poiId: string): boolean {
  if (!records.has(poiId)) return false
  records.delete(poiId)
  economics.delete(poiId)
  constructionJobs.delete(poiId)
  threatStates.delete(poiId)
  return true
}

export function resetColonies(): void {
  records.clear()
  economics.clear()
  constructionJobs.clear()
  buildPathState = freshBuildPathState()
  threatStates.clear()
}

export function restoreColonies(
  data: ColonyRecord[],
  economicsData?: Array<{ poiId: string; state: ColonyEconomicsState }>,
  constructionData?: Array<{ poiId: string; jobs: ConstructionJob[] }>,
  buildPath?: BuildPathState,
  threatData?: Array<{ poiId: string; state: ColonyThreatState }>,
): void {
  records.clear()
  economics.clear()
  constructionJobs.clear()
  threatStates.clear()
  for (const row of data) {
    records.set(row.poiId, {
      ...freshColonyRecord(row.poiId, row.adminEntityKey),
      ...row,
      // Backfill Phase 6.3.D fields absent from older save blobs.
      administratorKey: row.administratorKey ?? '',
      leadEngineerKey: row.leadEngineerKey ?? '',
      garrisonCommanderKey: row.garrisonCommanderKey ?? '',
      detentionOccupants: row.detentionOccupants ?? [],
    })
  }
  if (economicsData) {
    for (const { poiId, state } of economicsData) economics.set(poiId, { ...state })
  } else {
    // Upgrade path: records with no economics snapshot start fresh.
    for (const row of data) economics.set(row.poiId, freshEconomicsState())
  }
  if (constructionData) {
    for (const { poiId, jobs } of constructionData) constructionJobs.set(poiId, jobs.map((j) => ({ ...j })))
  }
  buildPathState = buildPath ? { ...buildPath } : freshBuildPathState()
  if (threatData) {
    for (const { poiId, state } of threatData) threatStates.set(poiId, { ...state })
  }
}

// Phase 6.3.C — construction job types and registry.

export type ConstructionStatus = 'inProgress' | 'completed'

export interface ConstructionJob {
  id: string
  poiId: string
  facilityTypeId: string
  authorizedDay: number
  durationDays: number
  status: ConstructionStatus
}

// Phase 6.3.C — build-path global state (charter + establishment package).
export interface BuildPathState {
  charterGranted: boolean
  charterFaction: string | null
  pirateAttentionFlag: boolean
  hasEstablishmentPackage: boolean
}

function freshBuildPathState(): BuildPathState {
  return {
    charterGranted: false,
    charterFaction: null,
    pirateAttentionFlag: false,
    hasEstablishmentPackage: false,
  }
}

// Phase 6.3.E — per-colony threat state.
// Persisted via src/boot/saveHandlers/colony.ts.
export interface ColonyThreatState {
  // Game-day number of the last pirate raid attempt. 0 = never.
  lastRaidAttemptDay: number
  // Game-day number when the stability floor was first breached.
  // 0 = colony is not currently in a collapse grace period.
  collapseGraceStartDay: number
}

function freshThreatState(): ColonyThreatState {
  return { lastRaidAttemptDay: 0, collapseGraceStartDay: 0 }
}

const constructionJobs = new Map<string, ConstructionJob[]>()
let buildPathState: BuildPathState = freshBuildPathState()
const threatStates = new Map<string, ColonyThreatState>()

export function addConstructionJob(job: ConstructionJob): void {
  const existing = constructionJobs.get(job.poiId) ?? []
  constructionJobs.set(job.poiId, [...existing, { ...job }])
}

export function getConstructionJobs(poiId: string): ConstructionJob[] {
  return constructionJobs.get(poiId) ?? []
}

export function getAllConstructionJobEntries(): Array<{ poiId: string; jobs: ConstructionJob[] }> {
  return [...constructionJobs.entries()].map(([poiId, jobs]) => ({ poiId, jobs }))
}

export function updateConstructionJob(poiId: string, jobId: string, patch: Partial<ConstructionJob>): boolean {
  const jobs = constructionJobs.get(poiId)
  if (!jobs) return false
  const idx = jobs.findIndex((j) => j.id === jobId)
  if (idx < 0) return false
  jobs[idx] = { ...jobs[idx], ...patch }
  return true
}

export function getBuildPathState(): BuildPathState {
  return { ...buildPathState }
}

export function setBuildPathState(patch: Partial<BuildPathState>): void {
  buildPathState = { ...buildPathState, ...patch }
}

// Phase 6.3.D — named-officer role assignment accessors.

export function assignColonyRole(poiId: string, role: ColonyRole, entityKey: string): boolean {
  const rec = records.get(poiId)
  if (!rec) return false
  const updated = { ...rec }
  if (role === 'administrator') updated.administratorKey = entityKey
  else if (role === 'leadEngineer') updated.leadEngineerKey = entityKey
  else if (role === 'garrisonCommander') updated.garrisonCommanderKey = entityKey
  records.set(poiId, updated)
  return true
}

export function getColonyRole(poiId: string, role: ColonyRole): string {
  const rec = records.get(poiId)
  if (!rec) return ''
  if (role === 'administrator') return rec.administratorKey
  if (role === 'leadEngineer') return rec.leadEngineerKey
  if (role === 'garrisonCommander') return rec.garrisonCommanderKey
  return ''
}

// Phase 6.3.D — colony detention occupant management.

export function getDetentionCapacity(): number {
  return colonyConfig.detention.defaultDetentionCapacity
}

export function getDetentionOccupants(poiId: string): string[] {
  return records.get(poiId)?.detentionOccupants ?? []
}

export function addDetentionOccupant(poiId: string, entityKey: string): boolean {
  const rec = records.get(poiId)
  if (!rec) return false
  if (rec.detentionOccupants.length >= getDetentionCapacity()) return false
  if (rec.detentionOccupants.includes(entityKey)) return false
  records.set(poiId, { ...rec, detentionOccupants: [...rec.detentionOccupants, entityKey] })
  return true
}

export function removeDetentionOccupant(poiId: string, entityKey: string): boolean {
  const rec = records.get(poiId)
  if (!rec) return false
  const next = rec.detentionOccupants.filter((k) => k !== entityKey)
  if (next.length === rec.detentionOccupants.length) return false
  records.set(poiId, { ...rec, detentionOccupants: next })
  return true
}
