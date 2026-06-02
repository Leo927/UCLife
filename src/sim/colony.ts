// Colony ownership registry — Phase 6.3.A.
// Phase 6.3.B extends with per-colony economics state.
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

const records = new Map<string, ColonyRecord>()
const economics = new Map<string, ColonyEconomicsState>()

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
