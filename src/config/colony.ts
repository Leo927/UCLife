import json5 from 'json5'
import raw from './colony.json5?raw'

export interface ColonyIncomeConfig {
  perFacilityType: Record<string, number>
  hangarResupplyPerDay: { supply: number; fuel: number }
}

export interface ColonyStabilityConfig {
  baseScore: number
  qolContribution: Record<string, number>
  missingQolPenaltyPerType: number
}

export interface ColonyRecruitmentConfig {
  colonySigningFeeDiscount: number
  colonyLoyaltyBonus: number
}

export interface ColonyResupplyConfig {
  markupFactor: number
}

export interface ColonyConfig {
  income: ColonyIncomeConfig
  stability: ColonyStabilityConfig
  recruitment: ColonyRecruitmentConfig
  resupply: ColonyResupplyConfig
}

export const colonyConfig = json5.parse(raw) as ColonyConfig
