import json5 from 'json5'
import raw from './frameProf.json5?raw'

export interface FrameProfConfig {
  windowSize: number
  percentile: number
  budgetMs: number
}

export const frameProfConfig = json5.parse(raw) as FrameProfConfig
