// Trait serializer manifest. Side-effect imports — each module registers
// its serializer at load time. Adding a new persisted trait == one new
// file in this directory + one line here.
//
// Order matters in two ways:
//   1. The on-disk EntitySnap field order is determined by registration
//      order. JSON object key order is preserved by superjson, so saves
//      written today have a stable key order.
//   2. Within the per-entity overlay loop, serializers run in this
//      order. Ambitions has a post-write side effect that reads the
//      entity's Attributes — Attributes MUST be registered before
//      Ambitions so the sheet is already patched when syncPerkModifiers
//      runs.

import './core'         // Character, Position, MoveTarget
import './vitals'       // Vitals, Health, Action
import './economy'      // Money, Skills, Inventory, JobPerformance
import './attributes'   // Attributes (must be before effects + progression)
import './effects'      // Effects (must be after attributes; rebuilds sheet)
import './placement'    // Bed, BarSeat, RoughSpot, Workstation
import './housingJob'   // Job, Home, PendingEviction
import './social'       // RoughUse, ChatTarget, ChatLine, Reputation, JobTenure, FactionRole
import './progression'  // Ambitions (depends on Attributes), Flags
