// Diplomacy registry — Phase 6.4.D.
// Tracks the player-faction's signed treaties with canon factions and the
// pending diplomat meeting requests raised on day:rollover. Layered on the
// 6.4.A FactionInterRep standing slot. Persisted via
// src/boot/saveHandlers/diplomacy.ts.

import type { FactionId } from '../config'
import type { TreatyType } from '../config/factions'
export type { TreatyType }

export interface TreatyRecord {
  type: TreatyType
  signedDay: number
  // Authored INERT in this slice. Phase 7 reads this to decide whether the
  // treaty escalates into a real faction-war trigger; no consequence is
  // wired here (mirrors the ambitions `warPayoff` inert-now / live-later
  // pattern). Seeded from config at signing time.
  postWarEscalation: string
}

// One diplomatic record per canon faction — the standing lives on the
// player-faction's FactionInterRep slot; the treaties layer on top of it.
export interface DiplomaticRecord {
  factionId: FactionId
  treaties: TreatyRecord[]
}

export interface MeetingRequest {
  factionId: FactionId
  requestedDay: number
}

const records = new Map<FactionId, DiplomaticRecord>()
const meetingRequests = new Map<FactionId, MeetingRequest>()

export function getDiplomaticRecord(factionId: FactionId): DiplomaticRecord | null {
  return records.get(factionId) ?? null
}

export function getAllDiplomaticRecords(): DiplomaticRecord[] {
  return [...records.values()]
}

export function hasTreaty(factionId: FactionId, type: TreatyType): boolean {
  return records.get(factionId)?.treaties.some((t) => t.type === type) ?? false
}

// Upsert a treaty onto the faction's record. Idempotent by type — re-signing
// the same treaty type replaces the prior entry (refreshes signedDay).
export function addTreaty(factionId: FactionId, treaty: TreatyRecord): void {
  const rec = records.get(factionId) ?? { factionId, treaties: [] }
  const treaties = rec.treaties.filter((t) => t.type !== treaty.type)
  treaties.push(treaty)
  records.set(factionId, { factionId, treaties })
}

export function getMeetingRequest(factionId: FactionId): MeetingRequest | null {
  return meetingRequests.get(factionId) ?? null
}

export function getAllMeetingRequests(): MeetingRequest[] {
  return [...meetingRequests.values()]
}

export function addMeetingRequest(req: MeetingRequest): void {
  meetingRequests.set(req.factionId, req)
}

export function clearMeetingRequest(factionId: FactionId): void {
  meetingRequests.delete(factionId)
}

export function resetDiplomacy(): void {
  records.clear()
  meetingRequests.clear()
}

export function restoreDiplomacy(
  diplomaticRecords: DiplomaticRecord[],
  requests: MeetingRequest[],
): void {
  records.clear()
  meetingRequests.clear()
  for (const r of diplomaticRecords) records.set(r.factionId, r)
  for (const m of requests) meetingRequests.set(m.factionId, m)
}
