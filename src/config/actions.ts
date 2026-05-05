import json5 from 'json5'
import raw from './actions.json5?raw'
import type { SkillId } from './skills'
import type { BedTier } from './kinds'

export interface ActionsConfig {
  defaults: {
    eat: number
    sleep: number
    flop: number
    wash: number
    work: number
    bar: number
    tap: number
    scavenge: number
    rough: number
    gym: number
  }
  inventory: {
    eat: number
    drink: number
    read: number
  }
  reading: {
    xpPerBook: number
    targetSkill: SkillId
    bookCapXp: number
  }
  sleepMinutesForFullRest: number
  barMinutesForFullFun: number
  bedMultipliers: Record<BedTier | 'none', number>
  rough: {
    tap:      { hygienePerMin: number; hpPerMin: number }
    scavenge: { hungerMult: number; hygienePerMin: number; hpPerMin: number }
    rough:    { hygienePerMin: number; hpPerMin: number }
  }
  premiumMealCharismaFeed: number
  chatting: {
    durationMin: number
    boredomPerMin: number
    hygienePerMin: number
    opinionPerMin: number
    inviteRangePx: number
    boredomMin: number
    arriveDistPx: number
  }
}

export const actionsConfig = json5.parse(raw) as ActionsConfig
