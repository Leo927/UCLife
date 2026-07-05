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
  enemyPickRadius: number
  autopilotArriveRadiusPx: number
  liftLine: {
    dashWorldPx: number
    gapWorldPx: number
    strokeWorldPx: number
    colorHex: string
    alpha: number
  }
}

export const spaceConfig = json5.parse(raw) as SpaceConfig
