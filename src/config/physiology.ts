import json5 from 'json5'
import raw from './physiology.json5?raw'

export interface PhysiologyConfig {
  hygieneSaturation: number
  vitalsSaturationDailyRoll: number
  fatigueForEnvironmentInjury: number
  reflexForLaborInjury: number
  selfTreatMinSkillLevel: number
}

export const physiologyConfig = json5.parse(raw) as PhysiologyConfig
