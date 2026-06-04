import json5 from 'json5'
import raw from './factions.json5?raw'

// Canonical faction-id union. data/factions.ts re-exports it for
// callers already importing from there. 'civilian' is the default for
// unaffiliated NPCs so FactionRole always has a concrete value and
// faction queries return a meaningful set. 'federation' and 'zeon'
// currently exist only as reputation buckets — no jobs or NPC
// affiliation in 5.0; ambition stages reference them.
export type FactionId =
  | 'anaheim' | 'civilian' | 'federation' | 'zeon' | 'pirate'
  // Phase 5.5.5 — the player-led faction. Bootstrapped like every other
  // catalog row; "officially created" is gated by the IsPlayerFaction
  // marker trait so save round-trip doesn't need a special spawn path.
  | 'player'

export type FactionTier = 'S' | 'A' | 'B' | 'C' | 'D' | 'E'

export interface FactionSpec {
  nameZh: string
  shortZh: string
  accentColor: string
  repPerShift: number
  seniorPromotionMinOpinion: number
}

// Phase 6.4.A — faction-tier emergence gate thresholds + regional ceiling.
export interface FactionTierGateConfig {
  minColonies: number
  minShips: number
  minCanonRepSum: number
  regionalPowerCeiling: number
}

// Phase 6.4.D — diplomacy treaty types the player can propose at a council.
export type TreatyType = 'nonaggression' | 'trade' | 'mutualDefense'

export interface TreatySpec {
  labelZh: string
  // FactionStatId -> additive delta on the 1.0-base multiplier knob. Typed
  // as a string map because the config layer sits below stats/ and cannot
  // import FactionStatId; the diplomacy system casts keys when building
  // modifiers (the same `statId as FactionStatId` pattern governance uses).
  effect: Record<string, number>
  // Authored INERT in Phase 6.4.D — Phase 7 reads this to decide whether a
  // treaty escalates into a real faction-war trigger. No consequence wired
  // in this slice.
  postWarEscalation: string
}

export interface DiplomacyConfig {
  meetingRequestThreshold: number
  stanceWeights: {
    intelligencePerLevel: number
    charismaPerLevel: number
    opinionPerPoint: number
  }
  stanceMidpoint: number
  stanceNeutralBand: number
  treaties: Record<TreatyType, TreatySpec>
}

export interface FactionsConfig {
  catalog: Record<string, FactionSpec>
  // Each entry is the minimum rep value to qualify for that grade.
  tierThresholds: Record<FactionTier, number>
  // Phase 6.4.A — faction-tier gate constants.
  factionTierGate: FactionTierGateConfig
  // Phase 6.4.D — diplomacy treaty catalog + meeting threshold.
  diplomacy: DiplomacyConfig
}

export const factionsConfig = json5.parse(raw) as FactionsConfig
