import json5 from 'json5'
import raw from './governance.json5?raw'
import type { CauseTags } from './psychology'

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
  // Phase 5.3 — options that constitute a public stance carry cause tags
  // (psychology.json5 vocabulary) + the zh deed phrase for the
  // grievance/credit reveal line. Options absent from these maps are not
  // stances and trigger no reaction.
  causeTags?: Record<string, CauseTags>
  stanceDeedZh?: Record<string, string>
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
