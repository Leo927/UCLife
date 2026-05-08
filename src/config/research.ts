import json5 from 'json5'
import raw from './research.json5?raw'

export interface ResearchConfig {
  baseResearchPerShift: number
  perfMin: number
  perfMax: number
}

export const researchConfig = json5.parse(raw) as ResearchConfig
