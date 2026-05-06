import json5 from 'json5'
import raw from './factions.json5?raw'

// Canonical faction-id union. data/factions.ts re-exports it for
// callers already importing from there. 'civilian' is the default for
// unaffiliated NPCs so FactionRole always has a concrete value and
// faction queries return a meaningful set. 'federation' and 'zeon'
// currently exist only as reputation buckets — no jobs or NPC
// affiliation in 5.0; ambition stages reference them.
export type FactionId = 'anaheim' | 'civilian' | 'federation' | 'zeon' | 'pirate'

export type FactionTier = 'S' | 'A' | 'B' | 'C' | 'D' | 'E'

export interface FactionSpec {
  nameZh: string
  shortZh: string
  accentColor: string
  repPerShift: number
  seniorPromotionMinOpinion: number
}

export interface FactionsConfig {
  catalog: Record<string, FactionSpec>
  // Each entry is the minimum rep value to qualify for that grade.
  tierThresholds: Record<FactionTier, number>
}

export const factionsConfig = json5.parse(raw) as FactionsConfig
