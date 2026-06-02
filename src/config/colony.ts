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

export interface ColonyCharterConfig {
  feeBase: number
  repGate: number
  factions: string[]
}

export interface ColonyConstructionConfig {
  durationDays: Record<string, number>
  interruptChancePerJobPerDay: number
}

export interface ColonyEstablishmentPackageConfig {
  cost: number
  cargoId: string
}

export interface ColonyConfig {
  income: ColonyIncomeConfig
  stability: ColonyStabilityConfig
  recruitment: ColonyRecruitmentConfig
  resupply: ColonyResupplyConfig
  charter: ColonyCharterConfig
  construction: ColonyConstructionConfig
  establishmentPackage: ColonyEstablishmentPackageConfig
}

export const colonyConfig = json5.parse(raw) as ColonyConfig
