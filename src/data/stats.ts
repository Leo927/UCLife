import { attributesConfig } from '../config'

export type StatId = 'strength' | 'endurance' | 'charisma' | 'intelligence' | 'reflex' | 'resolve'

export const STATS: Record<StatId, { label: string }> = {
  strength: { label: '力量' },
  endurance: { label: '耐力' },
  charisma: { label: '魅力' },
  intelligence: { label: '智力' },
  reflex: { label: '反应' },
  resolve: { label: '意志' },
}

export const STAT_ORDER: StatId[] = [
  'strength', 'endurance', 'charisma', 'intelligence', 'reflex', 'resolve',
]

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
