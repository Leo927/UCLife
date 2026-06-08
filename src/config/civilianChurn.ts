import json5 from 'json5'
import raw from './civilianChurn.json5?raw'

export interface CivilianChurnConfig {
  rollCadenceDays: number
  npcChurnChance: number
  fledChance: number
}

export const civilianChurnConfig = json5.parse(raw) as CivilianChurnConfig
