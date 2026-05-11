// Save handler manifest. Side-effect imports — each module registers
// its handler at load time. Adding a 16th persisted subsystem == one
// new file in this directory + one line here.
//
// Order is irrelevant: registry uses `phase` ('pre' | 'post') for
// ordering, and within a phase handlers are independent (no handler
// reads or writes another handler's state during snapshot/restore).

import './scene'        // phase: 'pre'  — active scene id
import './clock'        // phase: 'post' — gameDate
import './population'   // phase: 'post' — counters
import './combat'       // phase: 'post' — transient (reset only)
import './engagement'   // phase: 'post' — transient (reset only)
import './promotion'    // phase: 'post' — transient (reset only)
import './npc'          // phase: 'post' — transient (reset only)
import './activeZone'   // phase: 'post' — transient (reset only)
import './vitals'       // phase: 'post' — transient (reset only)
import './stress'       // phase: 'post' — transient (reset only)
import './supplyDrain'  // phase: 'post' — transient (reset only)
import './spaceSim'     // phase: 'post' — transient (reset only)
import './ship'         // phase: 'post' — long-arc ship state
import './space'        // phase: 'post' — spaceCampaign physics state
import './relations'    // phase: 'post' — Knows graph (needs entities)
import './dailyEconomics' // phase: 'post' — transient (reset only)
import './recruitment'  // phase: 'post' — applicant counter
import './brig'         // phase: 'post' — named-POW roster
