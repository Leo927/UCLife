// Shared string-literal kind unions for traits, interactables, and
// action verbs. Lives in config/ so config-layer schema files (jobs,
// actions) and data-layer rosters can name these kinds without
// reaching upward into ecs/. The ecs/traits/* trait declarations
// re-export the same unions as their public type so existing
// `import { BedTier } from '../ecs/traits'` callers keep working
// unchanged.

export type BedTier = 'flop' | 'dorm' | 'apartment' | 'luxury' | 'lounge'

export type RoadKind = 'avenue' | 'street' | 'alley'

// Cell verbs. Two categories per Design/social/diegetic-management.md:
//   • Always-active interactables — the cell *is* the verb (bed, bar
//     seat, wash basin, transit turnstile, etc., plus the player's own
//     work cell and the per-facility 'manage' cell).
//   • Job-site cells — scenery, no verb. Service-side workstations
//     (cashier, clinic, pharmacy, hr, secretary, recruiter, ae
//     reception, factory manager, ship dealer) have their workstation
//     entities spawned WITHOUT an Interactable trait; the player
//     interacts via talk-verb on the worker on duty.
export type InteractableKind =
  | 'eat' | 'sleep' | 'wash' | 'work' | 'bar'
  | 'tap' | 'scavenge' | 'rough'
  | 'gym'
  | 'transit'
  | 'ticketCounter'
  | 'orbitalLift'
  | 'boardShip'
  | 'disembarkShip'
  | 'helm'
  | 'manage'
  | 'captainsDesk'
  | 'commPanel'
  | 'brig'
  | 'climbIntoMs'

export type ActionKind =
  | 'idle' | 'walking' | 'eating' | 'sleeping' | 'washing'
  | 'working' | 'reading' | 'drinking' | 'reveling' | 'chatting'
  | 'exercising'

export type RoughKind = 'tap' | 'scavenge' | 'rough'
