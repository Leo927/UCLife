import json5 from 'json5'
import raw from './governance.json5?raw'

export interface PolicyEffects {
  revenueMul?: number
  salaryMul?: number
  maintenanceMul?: number
  researchSpeedMul?: number
  recruitChanceMul?: number
  loyaltyDriftMul?: number
}

export interface PolicySpec {
  defaultValue: string | number
  options: Array<string | number>
  labelZh: string
  effects: Record<string, PolicyEffects>
}

export interface GovernanceConfig {
  dissentDurationDays: number
  dissentMoodDelta: number
  policies: {
    taxation: PolicySpec
    alignment: PolicySpec
    tradePriority: PolicySpec
  }
  stanceWeights: {
    intelligencePerLevel: number
    charismaPerLevel: number
    opinionPerPoint: number
  }
}

export const governanceConfig = json5.parse(raw) as GovernanceConfig

export type PolicyKind = 'taxation' | 'alignment' | 'tradePriority'
