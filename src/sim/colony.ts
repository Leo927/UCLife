// Colony ownership registry — Phase 6.3.A.
// Phase 6.3.B extends with per-colony economics state.
// Phase 6.3.C extends with construction jobs and build-path state.
// Tracks which POIs the player-faction has claimed.
// Keyed by poiId; each record carries the entity key of the installed admin.
// State persists via src/boot/saveHandlers/colony.ts.

export interface ColonyRecord {
  poiId: string
  adminEntityKey: string | null
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

// Phase 6.3.C — construction job for a single facility being built.
// Keyed by a stable jobId (poiId + facilityType + incrementing counter).
export interface ConstructionJob {
  jobId: string
  poiId: string
  facilityType: string
  daysRemaining: number
  status: 'in_progress' | 'completed'
}

// Phase 6.3.C — fleet-level build-path acquisition state.
// Tracks whether the charter has been granted and the establishment
// package is stowed in the fleet cargo hold.
export interface BuildPathState {
  charterGranted: boolean
  charterFaction: string | null
  packageInFleet: boolean
}

const records = new Map<string, ColonyRecord>()
const economics = new Map<string, ColonyEconomicsState>()
// Phase 6.3.C — per-colony construction jobs. Inner key = jobId.
const constructionJobs = new Map<string, Map<string, ConstructionJob>>()
let buildPathState: BuildPathState = { charterGranted: false, charterFaction: null, packageInFleet: false }
let _jobCounter = 0

export function claimColony(poiId: string, adminEntityKey: string | null): void {
  records.set(poiId, { poiId, adminEntityKey })
  if (!economics.has(poiId)) {
    economics.set(poiId, freshEconomicsState())
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

export function resetColonies(): void {
  records.clear()
  economics.clear()
}

export function restoreColonies(
  data: ColonyRecord[],
  economicsData?: Array<{ poiId: string; state: ColonyEconomicsState }>,
): void {
  records.clear()
  economics.clear()
  for (const row of data) records.set(row.poiId, { ...row })
  if (economicsData) {
    for (const { poiId, state } of economicsData) economics.set(poiId, { ...state })
  } else {
    // Upgrade path: records with no economics snapshot start fresh.
    for (const row of data) economics.set(row.poiId, freshEconomicsState())
  }
}

// Phase 6.3.C — build-path state accessors.

export function getBuildPathState(): BuildPathState {
  return { ...buildPathState }
}

export function setBuildPathState(state: BuildPathState): void {
  buildPathState = { ...state }
}

// Phase 6.3.C — construction job accessors.

export function addConstructionJob(poiId: string, facilityType: string, daysRequired: number): ConstructionJob {
  const jobId = `${poiId}:${facilityType}:${_jobCounter++}`
  const job: ConstructionJob = { jobId, poiId, facilityType, daysRemaining: daysRequired, status: 'in_progress' }
  const colonyJobs = constructionJobs.get(poiId) ?? new Map<string, ConstructionJob>()
  colonyJobs.set(jobId, job)
  constructionJobs.set(poiId, colonyJobs)
  return job
}

export function getConstructionJobs(poiId: string): ConstructionJob[] {
  const m = constructionJobs.get(poiId)
  if (!m) return []
  return [...m.values()]
}

export function updateConstructionJob(job: ConstructionJob): void {
  const m = constructionJobs.get(job.poiId)
  if (!m) return
  m.set(job.jobId, { ...job })
}

export function getAllConstructionJobEntries(): Array<{ poiId: string; jobs: ConstructionJob[] }> {
  return [...constructionJobs.entries()].map(([poiId, m]) => ({ poiId, jobs: [...m.values()] }))
}

export function restoreConstructionJobs(
  entries: Array<{ poiId: string; jobs: ConstructionJob[] }>,
): void {
  constructionJobs.clear()
  for (const { poiId, jobs } of entries) {
    const m = new Map<string, ConstructionJob>()
    for (const job of jobs) m.set(job.jobId, { ...job })
    constructionJobs.set(poiId, m)
    // Restore counter past the highest observed index so new jobs don't collide.
    for (const job of jobs) {
      const parts = job.jobId.split(':')
      const idx = parseInt(parts[parts.length - 1], 10)
      if (!isNaN(idx) && idx >= _jobCounter) _jobCounter = idx + 1
    }
  }
}

export function resetConstructionState(): void {
  constructionJobs.clear()
  buildPathState = { charterGranted: false, charterFaction: null, packageInFleet: false }
  _jobCounter = 0
}
