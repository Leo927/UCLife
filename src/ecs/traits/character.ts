// Character traits — every datum that lives on a player or NPC entity.
// Player-only flags (IsPlayer, AtHelm, Ambitions, Flags) live here too;
// they're conceptually part of the character data model, not the world.

import { trait, relation } from 'koota'
import type { Entity } from 'koota'
import type { FactionId } from '../../data/factions'
import { createCharacterSheet, type StatId } from '../../stats/schema'
import type { StatSheet } from '../../stats/sheet'

export const Vitals = trait({
  hunger: 0,
  thirst: 0,
  fatigue: 0,
  hygiene: 0,
  // 0 = freshly entertained, 100 = stir-crazy. Display label: 烦闷.
  boredom: 0,
})

// Per-attribute drift parameters. `talent` (0.7–1.4) is the hidden cap
// multiplier; `recentUse` and `recentStress` are 7-day rolling buffers the
// daily drift system reads. Lives on the trait, not in the modifier
// sheet — these aren't stats, they're inputs to the function that shifts a
// stat's base value over time.
export interface AttributeDrift {
  recentUse: number
  recentStress: number
  talent: number
}

const newDrift = (): AttributeDrift => ({ recentUse: 50, recentStress: 0, talent: 1.0 })

// One sheet per character holds every modifier-driven stat: the six
// drifting attributes plus per-vital max + drain multipliers and HP
// max + regen multiplier (see src/stats/schema.ts). The drift map below
// is keyed by the six attribute IDs only — vital/HP stats don't drift.
export const Attributes = trait(() => ({
  sheet: createCharacterSheet(),
  drift: {
    strength: newDrift(),
    endurance: newDrift(),
    charisma: newDrift(),
    intelligence: newDrift(),
    reflex: newDrift(),
    resolve: newDrift(),
  } as Record<'strength' | 'endurance' | 'charisma' | 'intelligence' | 'reflex' | 'resolve', AttributeDrift>,
  // Used to apply drift exactly once per game-day and to skip newly-spawned
  // characters until their first rollover.
  lastDriftDay: 0,
}))

export type { StatId, StatSheet }

export const Health = trait({ hp: 100, dead: false })

export const Money = trait({ amount: 0 })

export const Skills = trait({
  mechanics: 0,
  marksmanship: 0,
  athletics: 0,
  cooking: 0,
  medicine: 0,
  computers: 0,
  piloting: 0,
  bartending: 0,
  engineering: 0,
})

export const Inventory = trait({
  water: 0,
  meal: 0,
  // Same hunger payload as meal, but consumed first by eat() and tagged so
  // vitals hands out a charisma feed. Wealthy NPCs preferentially stock
  // these; the destitute never touch them.
  premiumMeal: 0,
  books: 0,
})

export const IsPlayer = trait()
export const QueuedInteract = trait()

// The player always carries Active.
export const Active = trait()

// Asymmetric on purpose — A.Knows(B) does not imply B.Knows(A). Unrequited
// crushes / one-sided grudges must be expressible.
export const Knows = relation({
  store: { opinion: 0, familiarity: 0, lastSeenMs: 0, meetCount: 0 },
})

export type ActionKind = 'idle' | 'walking' | 'eating' | 'sleeping' | 'washing' | 'working' | 'reading' | 'drinking' | 'reveling' | 'chatting' | 'exercising'

export const Action = trait({
  kind: 'idle' as ActionKind,
  remaining: 0,
  total: 0,
})

// Tags an actor while using a public/free survival source so vitals can
// apply the per-action penalty (hygiene gain + small HP loss) without a
// spatial lookup every tick.
export type RoughKind = 'tap' | 'scavenge' | 'rough'
export const RoughUse = trait({ kind: 'tap' as RoughKind })

// Asymmetric in storage but symmetric in semantics — both directions are
// always written together. A one-sided ChatTarget is treated as broken by
// chat() and cleared on the next BT tick.
export const ChatTarget = trait(() => ({ partner: null as Entity | null }))

export const ChatLine = trait({ text: '' })

// Without this throttle wander would re-pick every tick and the city would
// never settle into clusters; NPCs need to linger long enough at a
// destination to accumulate co-location time for friendships.
export const WanderState = trait({ nextPickMs: 0 })

// `unemployedSinceMs` 0 = "never observed unemployed" — the stress system
// lazy-inits to the current game time on the first tick it sees an
// unemployed entity, and uses the value to gate the grace period.
export const Job = trait(() => ({
  workstation: null as Entity | null,
  unemployedSinceMs: 0,
}))

export const Home = trait(() => ({ bed: null as Entity | null }))

// Time-bounded exit pass: when rent expires the cell door is logically
// locked against the tenant, but if eviction caught them inside they'd be
// stuck. Pathfinder treats *that specific* cell door as open for them until
// expireMs — long enough to walk out, short enough that they can't loiter back.
export const PendingEviction = trait(() => ({
  bedEntity: null as Entity | null,
  expireMs: 0,
}))

export const JobPerformance = trait({
  todayPerf: 0,
  lastUpdateDay: 0,
  wasInWindow: false,
})

export const Character = trait({
  name: '',
  color: '#cccccc',
  title: '',
})

// Values are concrete, not sentinel-defaults. Generated once at spawn time
// and pinned for the entity's lifetime — no per-render randomization.
// Skin / hair-style strings must come from FC's catalog (see
// helpers/artHelpers.js extractColor and the hair-style list).
export type Gender = 'male' | 'female'

export const Appearance = trait({
  gender: 'female' as Gender,
  physicalAge: 25,
  skin: 'light',
  hStyle: 'neat',
  hLength: 30,                  // 0 (bald) – 150 (very long)
  hColor: 'brown',
  pubicHStyle: 'neat',
  pubicHColor: 'brown',
  underArmHStyle: 'shaved',
  underArmHColor: 'brown',
  eyeIris: 'brown',
  weight: 0,                    // -100..+100; 0 = average
  muscles: 0,                   // -100..+100; 0 = unmuscled
  height: 165,                  // cm
  hips: 0,                      // -2..3
  butt: 2,                      // 0..10
  waist: 0,                     // -100..+100; negative = narrower
  boobs: 350,                   // mass in cc; 0 for male / flat-chested
  lips: 25,                     // 0..100
  makeup: 0,                    // 0 (none) – 8
})

// `rep` is sparse — only factions the entity has actually interacted with
// carry an entry, so a fresh character reads as "no rep with anyone yet"
// rather than as +0 with every faction. Values clamped to [-100, +100] by
// the addRep helper.
export const Reputation = trait(() => ({
  rep: {} as Partial<Record<FactionId, number>>,
}))

// Counts shifts at the *current* Job.workstation's specId; resets to 0 on
// hire or rank-up so each rank earns its own tenure.
export const JobTenure = trait({
  shiftsAtCurrentRank: 0,
})

export const FactionRole = trait({
  faction: 'civilian' as FactionId,
  role: 'staff' as 'staff' | 'manager' | 'board',
})

// Phase 5.0 — long-arc player goals (Sims-style aspiration model).
// Player-only trait.
//
// `active` holds every ambition the player is currently pursuing. There
// is no cap on simultaneous ambitions (per the Sims-pivot in
// Design/social/ambitions.md). Length 0 = not yet picked — AmbitionPanel
// forces open in picker mode until at least one is selected.
//
// `apBalance` is unspent Ambition Points; `apEarned` is lifetime total
// (used for UI display + history). Stage payoffs grant AP; perks are
// bought from the catalog by spending AP. Perks are permanent.
//
// `streakAnchorMs` supports stages whose conditions must hold continuously
// over time (dropout's "365 days at flop with no Job"). The system sets it
// when conditions hold and resets to null when they break.
export interface AmbitionSlot { id: string; currentStage: number; streakAnchorMs: number | null }
export interface AmbitionHistoryEntry { id: string; completedStages: number; droppedAtMs: number | null }

export const Ambitions = trait(() => ({
  active: [] as AmbitionSlot[],
  history: [] as AmbitionHistoryEntry[],
  apBalance: 0,
  apEarned: 0,
  perks: [] as string[],
}))

// String-keyed boolean flags set by ambition stage payoffs (and, later,
// other story beats). Phase 5.0 only writes — no consumers wired yet.
export const Flags = trait(() => ({
  flags: {} as Record<string, boolean>,
}))

// Marks an actor (player or crew NPC) currently manning a station. Cleared
// when they leave the room. `roomEntity` is the ShipRoom entity they're at.
export const CrewStation = trait(() => ({
  roomEntity: null as Entity | null,
}))

export const AtHelm = trait({
  // Marker on the player entity in spaceCampaign world while at-helm.
  // Slice 5 toggles this on enter / off when leaving the helm.
})
