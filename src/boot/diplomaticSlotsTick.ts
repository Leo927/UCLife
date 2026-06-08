// Phase 7.0.E.4 — runs the diplomatic-slot occupancy eval on
// day:rollover:settled (gated on isWartime inside diplomaticSlotsTick).
// Subscription lives in boot/ so the loop and the system stay free of upward
// imports.

import { onSim } from '../sim/events'
import { isWartime } from '../sim/warState'
import { diplomaticSlotsTick } from '../systems/diplomaticSlots'

onSim('day:rollover:settled', () => {
  diplomaticSlotsTick(isWartime())
})
