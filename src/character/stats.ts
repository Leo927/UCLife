// Character-side facade over src/stats/. Holds the zh-CN labels for the
// six attributes plus the linear stat→multiplier helpers used by every
// system that reads an attribute's effect on action speed, vital drain,
// or work performance. The modifier-based StatSheet engine itself lives
// at src/stats/{schema,sheet,perkSync}.ts and is re-exported below.

import { attributesConfig } from '../config'
import { ATTRIBUTE_IDS, type AttributeId } from '../stats/schema'

export type { AttributeId } from '../stats/schema'

export const STATS: Record<AttributeId, { label: string }> = {
  strength: { label: '力量' },
  endurance: { label: '耐力' },
  charisma: { label: '魅力' },
  intelligence: { label: '智力' },
  reflex: { label: '反应' },
  resolve: { label: '意志' },
}

export const STAT_ORDER: readonly AttributeId[] = ATTRIBUTE_IDS

export const STAT_FLOOR = attributesConfig.floor
export const STAT_DRIFT = attributesConfig.drift
export const RECENT_USE_DECAY_PER_DAY = attributesConfig.recentUseDecayPerDay
export const RECENT_STRESS_DECAY_PER_DAY = attributesConfig.recentStressDecayPerDay
export const FEED = attributesConfig.feed

// Linear mapping: value=0..100 → [min..max]. Higher stat = better (work
// perf, move speed, skill XP).
export function statMult(value: number): number {
  const v = Math.max(0, Math.min(100, value))
  const { min, max } = attributesConfig.multiplierRange
  return min + (max - min) * (v / 100)
}

// Inverse: value=0..100 → [max..min]. Higher stat = lower drain / shorter time.
export function statInvMult(value: number): number {
  const v = Math.max(0, Math.min(100, value))
  const { min, max } = attributesConfig.multiplierRange
  return max - (max - min) * (v / 100)
}
