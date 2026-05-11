import json5 from 'json5'
import raw from './combat.json5?raw'

export interface CombatConfig {
  logMaxEntries: number
  logVisibleSec: number
  logFadeSec: number
  flagshipPauseHullPcts: number[]
  tallyCreditsMin: number
  tallyCreditsMax: number
  tallySuppliesGain: number
  tallyFuelGain: number
}

export const combatConfig = json5.parse(raw) as CombatConfig
