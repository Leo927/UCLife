// Phase 6.4.A — wires factionTierSystem to day:rollover:settled so the
// gate check runs after economics + colonies + construction settle for
// the day. The subscription lives in boot/ so the loop stays free of
// upward imports into systems/.

import { onSim } from '../sim/events'
import { factionTierSystem } from '../systems/factionTier'

onSim('day:rollover:settled', ({ gameDay }) => {
  factionTierSystem(gameDay)
})
