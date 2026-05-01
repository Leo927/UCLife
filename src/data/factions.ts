import { factionsConfig } from '../config'

// 'civilian' is the default for unaffiliated NPCs so FactionRole always has
// a concrete value and faction queries return a meaningful set.
export type FactionId = 'anaheim' | 'civilian'

export type FactionTier = 'S' | 'A' | 'B' | 'C' | 'D' | 'E'

export function factionMeta(id: FactionId) {
  return factionsConfig.catalog[id]
}

export function tierOf(rep: number): FactionTier {
  const t = factionsConfig.tierThresholds
  if (rep >= t.S) return 'S'
  if (rep >= t.A) return 'A'
  if (rep >= t.B) return 'B'
  if (rep >= t.C) return 'C'
  if (rep >= t.D) return 'D'
  return 'E'
}
