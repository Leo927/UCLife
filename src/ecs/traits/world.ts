// World traits — physical structures and interactables that make up a scene.
// Things characters walk into, sit on, work at, or rent a bed from.

import { trait } from 'koota'
import type { Entity } from 'koota'
import type { FactionId, BedTier, InteractableKind, RoadKind } from '../../config'

// Re-export so existing `import { BedTier } from '../ecs/traits'`
// callers keep working. Canonical declarations live in config/kinds.ts.
export type { BedTier, InteractableKind, RoadKind }

// Ownership kind for the Owner trait. 'state' has no entity ref — civic
// facilities operate at baseline with no payroll model. 'faction' and
// 'character' both reference an entity in the same world via Owner.entity.
// Phase 5.5 introduces this abstraction; Phase 5.5.1+ surfaces it through
// the realtor and daily-economics systems.
export type OwnerKind = 'state' | 'faction' | 'character'

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

// Per-facility owner-control cell. Spawned at building center when the
// type declares `hasManageCell: true`. The interaction system gates
// activation on Owner.kind === 'character' && Owner.entity === player —
// non-owners walking onto the tile see no verb (a stray inert cell, by
// design). When active, opens ManageFacilityDialog keyed by `building`.
export const ManageCell = trait({
  building: null as Entity | null,
})

// `typeId` matches a row in `data/building-types.json5` — the realtor uses
// it to look up category + pricing in `realty.json5`. Reset to '' for legacy
// non-listable buildings (e.g. ship interior rooms reuse the Building trait
// for room bounds — see bootstrapShipScene).
export const Building = trait({
  x: 0, y: 0, w: 0, h: 0,
  label: '',
  typeId: '',
})

// One shift slot at a workplace. Multiple Workstations may share a Position
// (e.g. shop counter has a morning + evening shift). Static job data
// (title, wage, shift, skill, requirements, description) lives in
// config/jobs.json5 keyed by specId; resolve via getJobSpec(specId).
//
// `managerStation`: when non-null, this station's hires go through that
// manager's talk-verb (FactoryManagerConversation in NPCDialog) instead
// of the public city HR window. Set at spawn time when a building
// contains both a recruiting-manager supervisor (today: factory_manager
// by specId) and one or more role:'worker' stations (see ecs/spawn.ts).
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
//
// Phase 5.5.3 `claimedBy`: faction-bed claim independent of nightly rent.
// When the bed sits in a player-owned residential facility, the secretary's
// auto-assignment writes the assigned member here so housing-pressure
// queries don't need to walk the rent ledger. A claim does not pay rent
// — it's a faction perk; the rent system continues to skip owned beds.
export const Bed = trait({
  tier: 'flop' as BedTier,
  nightlyRent: 0,
  occupant: null as Entity | null,
  rentPaidUntilMs: 0,
  owned: false,
  claimedBy: null as Entity | null,
})

export const Transit = trait({
  terminalId: '',
})

export const FlightHub = trait({
  hubId: '',
})

// Phase 6.2.A.2 — orbital-lift kiosk binding. Sits alongside an Interactable
// of kind 'orbitalLift'. `liftId` keys into orbital-lifts.json5 to resolve
// the (durationMin, fare, paired-scene) economics; the interaction system
// reads the kiosk's current-scene id off the active world to pick which
// endpoint is the destination.
export const OrbitalLift = trait({
  liftId: '',
})

export const Helm = trait({
  // An interact tile in playerShipInterior that, when pressed E, takes
  // helm. Slice 5 wires the actual interaction; this trait is the
  // anchor a slice-5 'helm' Interactable kind will reference.
})

// Phase 5.5 ownership tag. Sits on every Building and (later) ownable
// entity. `entity` is null for kind='state', the Faction entity for
// kind='faction', and the Character entity for kind='character'. Save
// round-trip resolves the ref via EntityKey, so faction/character entity
// must carry one to be persistable.
export const Owner = trait({
  kind: 'state' as OwnerKind,
  entity: null as Entity | null,
})

// First-class Faction entity. Phase 5.5.0 ships the bare minimum:
// canonical id + a fund. Members continue to be tracked via the
// FactionRole trait on character entities until Phase 5.5.5's
// player-faction migration introduces an explicit MemberOf relation.
export const Faction = trait({
  id: 'civilian' as FactionId,
  fund: 0,
})

// Phase 5.5.6 — faction-side StatSheet, parallel to Attributes.sheet on
// characters. Holds revenueMul / salaryMul / maintenanceMul /
// researchSpeedMul / recruitChanceMul / loyaltyDriftMul. Authored by
// FactionEffectsList entries (the Effect family is reused; modifier rows
// target FactionStatId instead of StatId). See src/stats/factionSchema.ts.
import { type FactionStatId } from '../../stats/factionSchema'
import { createFactionSheet } from '../../stats/factionSchema'
import type { StatSheet } from '../../stats/sheet'
import type { Effect } from '../../stats/effects'
export const FactionSheet = trait(() => ({
  sheet: createFactionSheet(),
}))
export type { FactionStatId }
export type FactionStatSheet = StatSheet<FactionStatId>

// Faction-side Effect bag, mirroring the per-character Effects trait.
// Each entry's modifiers target FactionStatId; the FactionSheet's
// modifier arrays are derived from this list (rebuild on add/remove).
// Source strings: 'eff:research:<id>', 'eff:condition:<id>'…
export const FactionEffectsList = trait(() => ({
  list: [] as Effect<FactionStatId>[],
}))

// Faction-side binary unlock set. Stored as a deduplicated string array
// because koota traits round-trip through JSON; helpers in
// src/ecs/factionEffects.ts enforce Set semantics on add.
export const FactionUnlocks = trait(() => ({
  ids: [] as string[],
}))

// Phase 5.5.6 — research queue + accumulated progress per faction. The
// researchSystem at day:rollover walks every faction-owned researchLab,
// computes per-shift progress, accumulates against `queue[0]`'s cost,
// and rolls overflow into the next entry. Empty-queue overflow is lost
// and reported in `lostOverflowToday`.
//
// `yesterdayPerDay` snapshots the last full-day yield so the planner ETA
// reads "≈ ⌈(cost − accumulated) / yesterdayPerDay⌉ days" without a 7-day
// rolling window. `completed` is the running list of finished research
// ids, kept here (rather than on FactionUnlocks) so a research with no
// unlocks but with effects still leaves a visible "done" record in the
// planner.
export const FactionResearch = trait(() => ({
  queue: [] as string[],
  accumulated: 0,
  yesterdayPerDay: 0,
  lostOverflowToday: 0,
  completed: [] as string[],
}))

// Phase 6.2.A hangar facility. Sits alongside Building + Facility on
// hangar entities (state-rental + player-owned). The tier governs which
// slot classes the bay can hold; slotCapacity is the per-class cap. The
// occupant table (which ship sits in which slot) is empty at 6.2.A —
// ships don't enter hangars until 6.2.C1/C2 wire delivery placement.
//
// Phase 6.2.B — `repairPriorityShipKey` is the focus override the manager
// exposes via the repair-priority verb. Empty string = spread daily
// throughput evenly across every damaged ship docked at this hangar's
// POI. Non-empty = focus the full pool on that ship's EntityKey until
// it's fully repaired (then the player picks the next one).
import type { HangarTier, HangarSlotClass } from '../../data/facilityTypes'
export const Hangar = trait(() => ({
  tier: 'surface' as HangarTier,
  slotCapacity: {} as Partial<Record<HangarSlotClass, number>>,
  repairPriorityShipKey: '',
}))
export type { HangarTier, HangarSlotClass }

// Phase 5.5.4 recruiter station. Sits alongside Workstation on the
// recruiter's desk (specId='recruiter'). The criteria block is the
// auto-accept filter the player tunes via RecruiterDialog ("机师, 30
// 以上"); the daily generation pass reads it to decide which procgen
// applicants are auto-accepted on spawn vs. left in the lobby for
// player review. `cumulativeNoHireDays` powers the streak bonus from
// recruitment.json5. `lastRollDay` guards against same-day double-rolls
// when the loop force-emits day:rollover (tests, load).
import type { SkillId } from '../../config'
export interface RecruiterCriteria {
  // null = no skill gate; any applicant qualifies on the skill axis.
  skill: SkillId | null
  // Minimum skill level the applicant must have on `skill` to auto-accept.
  // Ignored when skill is null.
  minLevel: number
  // When false, every applicant queues for player review regardless of
  // skill match. When true, matching applicants are accepted on spawn.
  autoAccept: boolean
}
export const Recruiter = trait(() => ({
  criteria: { skill: null, minLevel: 0, autoAccept: false } as RecruiterCriteria,
  cumulativeNoHireDays: 0,
  lastRollDay: 0,
}))

// Phase 5.5.2 per-facility daily-economics state. Sits on every ownable
// Building. workSystem accumulates `revenueAcc` and `salariesAcc` across
// the day; the daily-economics rollover at midnight rolls those into the
// owner's fund along with maintenance, and updates `insolventDays`.
//
// `lastClosedDay` and `closedReason` flag a facility currently shuttered
// because its owner can't make payroll — workers refuse the shift on
// Day 2 onwards, drawn from the warning loop in
// Design/social/facilities-and-ownership.md.
export type FacilityClosedReason = 'insolvent'

export const Facility = trait({
  revenueAcc: 0,
  salariesAcc: 0,
  insolventDays: 0,
  // Last gameDayNumber the rollover ran for this facility. 0 = never.
  // Guards against a single rollover firing twice within one day (e.g.
  // tests force-advancing time, or a load that re-runs day:rollover).
  lastRolloverDay: 0,
  // 0 = open / solvent. >0 = the gameDayNumber the worker no-show kicked
  // in. Workstations on this facility short-circuit `working` actions
  // until cleared by a solvent rollover.
  closedSinceDay: 0,
  closedReason: null as FacilityClosedReason | null,
})
