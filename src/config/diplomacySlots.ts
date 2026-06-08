import json5 from 'json5'
import raw from './diplomacySlots.json5?raw'

export interface DiplomacySlotsConfig {
  consulateThreshold: number
  memberCountScalar: number
  staffPerSlot: number
  guardsPerSlot: number
  guardDetectRadiusPx: number
  staffDetectRadiusPx: number
  eligibleFactions: string[]
  enmity: Record<string, string[]>
}

export const diplomacySlotsConfig = json5.parse(raw) as DiplomacySlotsConfig
