import json5 from 'json5'
import raw from './economy.json5?raw'

export interface EconomyConfig {
  prices: {
    meal: number
    premiumMeal: number
    water: number
    barDrink: number
    flopBed: number
    dormBed: number
    apartmentBed: number
    luxuryBed: number
  }
  rent: {
    bedRentDurationDays: number
    flopBedHours: number
    apartmentDepositMult: number
  }
  purchase: {
    apartmentMonthsRent: number
    luxuryMonthsRent: number
  }
  wage: {
    npcBonus: number
    perfBreakpoints: {
      fullPay: number
      nearFull: number
      midRange: number
    }
    perfSlopes: {
      nearFull: number
      midRange: number
      low: number
    }
    midRangeBaseMult: number
  }
}

export const economyConfig = json5.parse(raw) as EconomyConfig
