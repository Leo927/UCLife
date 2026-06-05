// Phase 6.4.D — wires diplomacyMeetingRequestTick to day:rollover:settled so
// the meeting-request threshold check runs after colonies + faction-tier
// settle for the day (FactionInterRep is authoritative once the tier gate
// has run). The subscription lives in boot/ so the loop stays free of
// upward imports into systems/.

import { onSim } from '../sim/events'
import { diplomacyMeetingRequestTick } from '../systems/diplomacy'

onSim('day:rollover:settled', ({ gameDay }) => {
  diplomacyMeetingRequestTick(gameDay)
})
