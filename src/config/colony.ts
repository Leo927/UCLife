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

// Phase 6.3.C — charter acquisition config.
export interface ColonyCharterConfig {
  factions: string[]
  minFactionRep: number
  fee: number
}

// Phase 6.3.C — establishment package config.
export interface ColonyEstablishmentPackageConfig {
  cost: number
}

// Phase 6.3.C — construction timing config.
export interface ColonyConstructionConfig {
  daysPerType: Record<string, number>
  interruptChancePerColonyDay: number
}

export interface ColonyConfig {
  income: ColonyIncomeConfig
  stability: ColonyStabilityConfig
  recruitment: ColonyRecruitmentConfig
  resupply: ColonyResupplyConfig
  // Phase 6.3.C additions.
  charter: ColonyCharterConfig
  establishmentPackage: ColonyEstablishmentPackageConfig
  construction: ColonyConstructionConfig
}

export const colonyConfig = json5.parse(raw) as ColonyConfig
