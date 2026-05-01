import json5 from 'json5'
import raw from './ai.json5?raw'

export interface AIConfig {
  drives: {
    fatigueGoHome: number
    fatigueRested: number
    hungerGoHome: number
    hungerFed: number
    thirstGoHome: number
    thirstQuenched: number
    hygieneGoHome: number
    hygieneClean: number
    boredomGoToBar: number
    boredomFulfilled: number
  }
  stockTarget: {
    meal: number
    premiumMeal: number
    water: number
  }
  livingStandards: {
    wealthyCash: number
    destituteCash: number
  }
  relations: {
    proximityRadiusPx: number
    colocationOpinionPerMin: number
    colocationFamiliarityPerMin: number
    greetCooldownMin: number
    firstGreetOpinion: number
    firstGreetFamiliarity: number
    greetOpinion: number
    greetFamiliarity: number
    dailyOpinionDecay: number
    dailyFamiliarityDecay: number
    opinionMin: number
    opinionMax: number
    familiarityMax: number
    logCooldownMin: number
    lonelyWindowMin: number
    lonelyBoredomMult: number
  }
}

export const aiConfig = json5.parse(raw) as AIConfig
