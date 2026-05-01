import json5 from 'json5'
import raw from './attributes.json5?raw'

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'E'

export interface AttributesConfig {
  floor: number
  drift: number
  recentUseDecayPerDay: number
  recentStressDecayPerDay: number
  feed: {
    work: number
    reading: number
    sleep: number
    walk: number
    reveling: number
    gym: number
  }
  multiplierRange: {
    min: number
    max: number
  }
  spawnDefaults: {
    value: number
    talent: number
    recentUse: number
    recentStress: number
  }
  // E is the implicit floor band — not listed here.
  gradeThresholds: {
    S: number
    A: number
    B: number
    C: number
    D: number
  }
  gradeColors: Record<Grade, string>
  stress: {
    vitalSaturationThreshold: number
    unemploymentGraceDays: number
    feeds: {
      hygieneSaturated: number
      hungerSaturated: number
      thirstSaturated: number
      fatigueSaturated: number
      homeless: number
      unemployedLong: number
      reveling: number
      hpHurt: number
      hpSevere: number
    }
  }
}

export const attributesConfig = json5.parse(raw) as AttributesConfig
