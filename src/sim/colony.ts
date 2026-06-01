// Colony ownership registry — Phase 6.3.A.
// Tracks which POIs the player-faction has claimed.
// Keyed by poiId; each record carries the entity key of the installed admin.
// State persists via src/boot/saveHandlers/colony.ts.

export interface ColonyRecord {
  poiId: string
  adminEntityKey: string | null
}

const records = new Map<string, ColonyRecord>()

export function claimColony(poiId: string, adminEntityKey: string | null): void {
  records.set(poiId, { poiId, adminEntityKey })
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

export function resetColonies(): void {
  records.clear()
}

export function restoreColonies(data: ColonyRecord[]): void {
  records.clear()
  for (const row of data) records.set(row.poiId, { ...row })
}
