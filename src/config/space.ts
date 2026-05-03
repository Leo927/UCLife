import json5 from 'json5'
import raw from './space.json5?raw'

export interface SpaceConfig {
  shipSpeedScale: number
  baseShipMaxSpeed: number
  thrustAccel: number
  fuelPerThrustSec: number
  supplyDrainPerHour: number
  perMaintenanceLoadDrainPerHour: number
  combatRepairDrainPerSec: number
  orbitTimeScale: number
  aggroContactRadius: number
  fitSystemPaddingPx: number
  dockSnapRadius: number
}

export const spaceConfig = json5.parse(raw) as SpaceConfig
