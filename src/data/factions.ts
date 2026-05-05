import { factionsConfig, type FactionId, type FactionTier } from '../config'

// FactionId / FactionTier are declared in config/factions.ts (the
// schema layer); this module hosts the runtime helpers that read the
// loaded factionsConfig roster. Re-export the types so existing
// callers keep importing from data/factions.
export type { FactionId, FactionTier }

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
