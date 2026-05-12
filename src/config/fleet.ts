import json5 from 'json5'
import raw from './fleet.json5?raw'

export interface FleetConfig {
  baseRepairPerWorker: number
  managerScaleMin: number
  managerScaleMax: number
  perfMin: number
  perfMax: number
}

export const fleetConfig = json5.parse(raw) as FleetConfig
