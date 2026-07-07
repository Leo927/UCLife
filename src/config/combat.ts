import json5 from 'json5'
import raw from './combat.json5?raw'

export interface CombatConfig {
  logMaxEntries: number
  logVisibleSec: number
  logFadeSec: number
  flagshipPauseHullPcts: number[]
  defaultShipHitRadiusPx: number
  tallyCreditsMin: number
  tallyCreditsMax: number
  tallySuppliesGain: number
  tallyFuelGain: number
  rallyArriveRadiusPx: number
  orderPickRadiusPx: number
  fleePenalty: { hullLossPct: number; crDrain: number }
  defeat: { survivorMoney: number }
  withdrawConfirmWindowMs: number
  pilotAi: { boostDecisionWindowSec: number }
  tacticalStarfield: {
    count: number
    seed: number
    minRadiusPx: number
    maxRadiusPx: number
    minAlpha: number
    maxAlpha: number
    colorHex: string
  }
  shipSilhouettes: {
    fallback: string
    byClassId: Record<string, string>
    families: Record<string, { poly: number[] }>
  }
}

export const combatConfig = json5.parse(raw) as CombatConfig
