import json5 from 'json5'
import raw from './vitals.json5?raw'

export interface VitalsConfig {
  drain: {
    hunger: number
    thirst: number
    fatigue: number
    hygiene: number
    boredom: number
  }
  actions: {
    eating:   { hunger: number }
    drinking: { thirst: number }
    washing:  { hygiene: number }
    reveling: { boredom: number }
    sleeping: {
      hungerMult: number
      thirstMult: number
      fatigue: number
      boredom: number
    }
    working: {
      hungerMult: number
      thirstMult: number
      fatigueMult: number
      hygieneMult: number
      boredomMult: number
    }
    reading: {
      fatigueMult: number
    }
  }
  npcFatigueMult: number
  hpRegenPerMin: number
  hpDamagePerMin: {
    thirst: number
    hunger: number
    fatigue: number
  }
}

export const vitalsConfig = json5.parse(raw) as VitalsConfig
