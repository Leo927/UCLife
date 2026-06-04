// Phase 6.4.D — diplomacy save handler.
// Persists the player-faction's signed treaties (diplomatic-state records)
// and pending diplomat meeting requests. The treaty FactionEffect itself
// rides on the player-faction's FactionEffectsList, persisted by the
// research trait serializer — only the registry-side state lives here.

import { registerSaveHandler } from '../../save/registry'
import {
  getAllDiplomaticRecords, getAllMeetingRequests, resetDiplomacy, restoreDiplomacy,
  type DiplomaticRecord, type MeetingRequest,
} from '../../sim/diplomacy'

interface DiplomacySnapshot {
  records: DiplomaticRecord[]
  meetingRequests: MeetingRequest[]
}

registerSaveHandler<DiplomacySnapshot>({
  id: 'diplomacy',
  phase: 'post',
  snapshot: () => {
    const records = getAllDiplomaticRecords()
    const meetingRequests = getAllMeetingRequests()
    if (records.length === 0 && meetingRequests.length === 0) return undefined
    return { records, meetingRequests }
  },
  restore: (blob) => {
    restoreDiplomacy(blob.records ?? [], blob.meetingRequests ?? [])
  },
  reset: () => {
    resetDiplomacy()
  },
})
