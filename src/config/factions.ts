import json5 from 'json5'
import raw from './factions.json5?raw'

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
  tierThresholds: Record<'S' | 'A' | 'B' | 'C' | 'D' | 'E', number>
}

export const factionsConfig = json5.parse(raw) as FactionsConfig
