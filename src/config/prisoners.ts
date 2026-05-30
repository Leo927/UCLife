import json5 from 'json5'
import raw from './prisoners.json5?raw'

// Issue #70 — prisoner-system config schema. Faction asymmetries live in
// the data (the `approval` override maps); the resolver never branches on
// a faction id.

export type PrisonerVerb =
  | 'interrogate'
  | 'ransom'
  | 'recruit'
  | 'execute'
  | 'handOver'
  | 'release'

export interface PrisonerVerbOutcome {
  homeDelta: number
  captorDelta: number
  broadDelta: number
  // Per-faction override of homeDelta, keyed by faction id.
  approval: Record<string, number>
}

export interface PrisonersConfig {
  verbs: Record<PrisonerVerb, PrisonerVerbOutcome>
  neglectDeath: PrisonerVerbOutcome
  ransomCreditsBase: number
  handOverCredits: number
  maxHomeRepToRecruit: number
  interrogateThresholdFull: number
  interrogateThresholdPartial: number
  provisionStart: number
  provisionDecayPerDay: number
  provisionFloor: number
  neglectConditionId: string
  escapeAttemptChancePerDay: number
}

export const prisonersConfig = json5.parse(raw) as PrisonersConfig
