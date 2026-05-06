// World traits — physical structures and interactables that make up a scene.
// Things characters walk into, sit on, work at, or rent a bed from.

import { trait } from 'koota'
import type { Entity } from 'koota'
import type { FactionId, BedTier, InteractableKind, RoadKind } from '../../config'

// Re-export so existing `import { BedTier } from '../ecs/traits'`
// callers keep working. Canonical declarations live in config/kinds.ts.
export type { BedTier, InteractableKind, RoadKind }

export const Wall = trait({ x: 0, y: 0, w: 0, h: 0 })

// Procgen road surface — purely visual + semantic; the pathfinder treats
// it the same as any non-wall space. Drawn in the ground layer below
// buildings so a building's wall reads as flush against the road.
export const Road = trait({
  x: 0, y: 0, w: 0, h: 0,
  kind: 'avenue' as RoadKind,
})

// Two independent lock predicates: `bedEntity` keys cell doors to a specific
// bed's active renter; `factionGate` keys faction-internal doors. Both null
// = always open. Both set = locked unless the requester satisfies *either*.
export const Door = trait({
  x: 0, y: 0, w: 0, h: 0,
  orient: 'h' as 'h' | 'v',
  bedEntity: null as Entity | null,
  factionGate: null as FactionId | null,
})

// 'flop' and 'landlord' aren't here: flop beds use 'sleep' (rent semantics
// differ by Bed.tier, not by kind), and the apartment landlord desk uses
// 'manager' since the player clicks the bed under the per-bed rent model.
export const Interactable = trait({
  kind: 'eat' as InteractableKind,
  label: '',
  fee: 0,
})

export const Building = trait({
  x: 0, y: 0, w: 0, h: 0,
  label: '',
})

// One shift slot at a workplace. Multiple Workstations may share a Position
// (e.g. shop counter has a morning + evening shift). Static job data
// (title, wage, shift, skill, requirements, description) lives in
// config/jobs.json5 keyed by specId; resolve via getJobSpec(specId).
//
// `managerStation`: when non-null, this station's hires go through that
// manager's desk dialog instead of the public city HR window. Set at spawn
// time when a building contains both a kind:'manager' supervisor and one or
// more role:'worker' stations (see ecs/spawn.ts).
export const Workstation = trait({
  specId: '',
  occupant: null as Entity | null,
  managerStation: null as Entity | null,
})

export const BarSeat = trait({
  occupant: null as Entity | null,
})

export const RoughSpot = trait({
  occupant: null as Entity | null,
})

// `owned` is the realtor's purchase outcome — once true, the bed is the
// occupant's permanently. The rent system skips owned beds entirely, so
// rentPaidUntilMs is moot for the rest of the bed's lifetime. Only the
// player can buy under the current model.
export const Bed = trait({
  tier: 'flop' as BedTier,
  nightlyRent: 0,
  occupant: null as Entity | null,
  rentPaidUntilMs: 0,
  owned: false,
})

export const Transit = trait({
  terminalId: '',
})

export const FlightHub = trait({
  hubId: '',
})

export const Helm = trait({
  // An interact tile in playerShipInterior that, when pressed E, takes
  // helm. Slice 5 wires the actual interaction; this trait is the
  // anchor a slice-5 'helm' Interactable kind will reference.
})
