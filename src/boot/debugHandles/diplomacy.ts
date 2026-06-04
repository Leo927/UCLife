// Phase 6.4.D — diplomacy debug handles for deterministic smoke tests.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import {
  conveneDiplomacyCouncil, signTreaty, declineTreaty, diplomacyMeetingRequestTick,
} from '../../systems/diplomacy'
import { findPlayerFaction } from '../../systems/council'
import {
  getDiplomaticRecord, getAllDiplomaticRecords, getAllMeetingRequests, getMeetingRequest,
} from '../../sim/diplomacy'
import { FactionInterRep } from '../../ecs/traits'
import { gameDayNumber, useClock } from '../../sim/clock'
import type { FactionId, TreatyType } from '../../config'

// Convene a diplomacy council (gather attendees + stances) without signing.
registerDebugHandle('conveneDiplomacyCouncil', (poiId: string, factionId: string, treatyType: string) => {
  return conveneDiplomacyCouncil(poiId, factionId as FactionId, treatyType as TreatyType)
})

// Convene + sign a treaty in one call. Returns { ok, gameDay } or a reason.
registerDebugHandle('signTreaty', (poiId: string, factionId: string, treatyType: string) => {
  const session = conveneDiplomacyCouncil(poiId, factionId as FactionId, treatyType as TreatyType)
  if (!session) return { ok: false, reason: 'no_session' }
  const gameDay = gameDayNumber(useClock.getState().gameDate)
  const ok = signTreaty(session, gameDay)
  return { ok, gameDay }
})

// Convene + decline a treaty. No diplomatic-state change.
registerDebugHandle('declineTreaty', (poiId: string, factionId: string, treatyType: string) => {
  const session = conveneDiplomacyCouncil(poiId, factionId as FactionId, treatyType as TreatyType)
  if (!session) return { ok: false, reason: 'no_session' }
  return { ok: declineTreaty(session) }
})

// Run the day:rollover meeting-request check for the given game-day.
registerDebugHandle('forceDiplomacyMeetingTick', (gameDay?: number) => {
  const day = gameDay ?? gameDayNumber(useClock.getState().gameDate)
  diplomacyMeetingRequestTick(day)
  return { day }
})

// Get the diplomatic record (treaties) for a canon faction.
registerDebugHandle('getDiplomaticRecord', (factionId: string) =>
  getDiplomaticRecord(factionId as FactionId),
)

// Get all diplomatic records.
registerDebugHandle('getDiplomaticRecords', () => getAllDiplomaticRecords())

// Get all pending diplomat meeting requests.
registerDebugHandle('getDiplomacyMeetingRequests', () => getAllMeetingRequests())

// Get the pending meeting request for one faction (null when none).
registerDebugHandle('getDiplomacyMeetingRequest', (factionId: string) =>
  getMeetingRequest(factionId as FactionId),
)

// Set the player-faction's standing toward a canon faction. Used in smoke
// tests to push standing above the meeting threshold deterministically.
registerDebugHandle('setPlayerFactionInterRep', (factionId: string, value: number) => {
  const pf = findPlayerFaction()
  if (!pf) return { ok: false, reason: 'no_player_faction' }
  if (!pf.has(FactionInterRep)) return { ok: false, reason: 'no_inter_rep_trait' }
  const cur = pf.get(FactionInterRep)!.rep
  pf.set(FactionInterRep, { rep: { ...cur, [factionId]: value } })
  return { ok: true }
})
