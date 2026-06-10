import json5 from 'json5'
import raw from './psychology.json5?raw'

// Cause + temperament id sets live here (not in the json5) because cause
// ids become StatSheet stat ids (`${cause}Sym`) — the stat schema needs
// them as compile-time literals. The json5 carries display + tuning data
// keyed by these ids; the loader cross-checks the two below.
export const CAUSE_IDS = [
  'zeonism', 'federation_order', 'ae_pragmatism', 'pacifism',
] as const
export type CauseId = typeof CAUSE_IDS[number]

export const TEMPERAMENT_IDS = [
  'proud', 'idealistic', 'loyal', 'pragmatic', 'self_interested', 'timid',
] as const
export type TemperamentId = typeof TEMPERAMENT_IDS[number]

// Sparse per-cause weights, each in [-1, +1]. Used both for a character's
// sympathies and for an event's cause tags.
export type CauseTags = Partial<Record<CauseId, number>>

export interface PsychologyConfig {
  causes: Record<CauseId, { nameZh: string }>
  temperaments: Record<TemperamentId, { nameZh: string; reactionScaleDelta: number }>
  procgen: {
    sympathyCountMin: number
    sympathyCountMax: number
    magnitudeMin: number
    magnitudeMax: number
    magnitudeStep: number
    negativeChance: number
  }
  reaction: {
    opinionScale: number
    minAbsOpinionDelta: number
  }
  reveal: {
    strongAbsThreshold: number
  }
}

export const psychologyConfig = json5.parse(raw) as PsychologyConfig

for (const id of CAUSE_IDS) {
  if (!psychologyConfig.causes[id]) {
    throw new Error(`psychology.json5: missing causes.${id}`)
  }
}
for (const id of TEMPERAMENT_IDS) {
  if (!psychologyConfig.temperaments[id]) {
    throw new Error(`psychology.json5: missing temperaments.${id}`)
  }
}

export function isCauseId(s: string): s is CauseId {
  return (CAUSE_IDS as readonly string[]).includes(s)
}
export function isTemperamentId(s: string): s is TemperamentId {
  return (TEMPERAMENT_IDS as readonly string[]).includes(s)
}
