import json5 from 'json5'
import raw from './conscription.json5?raw'

export interface ConscriptionRefusalConfig {
  base: number
  federationRepWeight: number
  charismaWeight: number
  medicalLetterBonus: number
  bribeBonus: number
  proPilotAmbitionBias: number
  floor: number
  ceil: number
}

export interface ConscriptionConfig {
  rollCadenceDays: number
  cooldownDays: number
  noticeChance: number
  refusal: ConscriptionRefusalConfig
  bribeCost: number
  medicalLetterFee: number
  npcDraftChance: number
}

export const conscriptionConfig = json5.parse(raw) as ConscriptionConfig
