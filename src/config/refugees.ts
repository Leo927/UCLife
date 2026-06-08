import json5 from 'json5'
import raw from './refugees.json5?raw'

export interface RefugeesConfig {
  spawnCadenceDays: number
  regionRefugeeCap: number
  batchMax: number
  moneyMin: number
  moneyMax: number
}

export const refugeesConfig = json5.parse(raw) as RefugeesConfig
