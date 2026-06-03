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

export interface ColonyAdminLoadConfig {
  leadershipSkillStandin: string
  loadCapBase: number
  loadCapPerSkillLevel: number
  loadPerColony: number
  adminLoadReductionFraction: number
  overloadStabilityPenaltyPerPoint: number
}

export interface ColonyDetentionConfig {
  defaultDetentionCapacity: number
}

// Phase 6.3.E — threat configuration shape.
export interface ColonyThreatsConfig {
  baseRaidChancePerDay: number
  raidWealthFactor: number
  raidGarrisonFactor: number
  maxRaidChancePerDay: number
  pirateAttentionMultiplier: number
  garrisonStrengthPerBarracks: number
  garrisonCommanderSkillStandin: string
  garrisonStrengthPerCommanderSkillLevel: number
  autoResolveGarrisonThreshold: number
  raidThreatLevel: number
  raidCooldownDays: number
  stabilityFloor: number
  collapseGraceDays: number
}

export interface ColonyConfig {
  income: ColonyIncomeConfig
  stability: ColonyStabilityConfig
  recruitment: ColonyRecruitmentConfig
  resupply: ColonyResupplyConfig
  charter: ColonyCharterConfig
  construction: ColonyConstructionConfig
  establishmentPackage: ColonyEstablishmentPackageConfig
  adminLoad: ColonyAdminLoadConfig
  detention: ColonyDetentionConfig
  threats: ColonyThreatsConfig
}

export const colonyConfig = json5.parse(raw) as ColonyConfig
