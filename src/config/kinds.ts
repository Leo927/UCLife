// Shared string-literal kind unions for traits, interactables, and
// action verbs. Lives in config/ so config-layer schema files (jobs,
// actions) and data-layer rosters can name these kinds without
// reaching upward into ecs/. The ecs/traits/* trait declarations
// re-export the same unions as their public type so existing
// `import { BedTier } from '../ecs/traits'` callers keep working
// unchanged.

export type BedTier = 'flop' | 'dorm' | 'apartment' | 'luxury' | 'lounge'

export type RoadKind = 'avenue' | 'street' | 'alley'

export type InteractableKind =
  | 'eat' | 'sleep' | 'wash' | 'work' | 'shop' | 'hr' | 'bar' | 'manager'
  | 'tap' | 'scavenge' | 'rough'
  | 'aeReception'
  | 'gym'
  | 'transit'
  | 'ticketCounter'
  | 'buyShip'
  | 'boardShip'
  | 'disembarkShip'
  | 'helm'

export type ActionKind =
  | 'idle' | 'walking' | 'eating' | 'sleeping' | 'washing'
  | 'working' | 'reading' | 'drinking' | 'reveling' | 'chatting'
  | 'exercising'

export type RoughKind = 'tap' | 'scavenge' | 'rough'
