import json5 from 'json5'
import raw from './sortie.json5?raw'

export interface OnShipRepairConfig {
  pointsPerDay: number
  defaultCap: number
  defaultFloor: number
}

export interface SortieConfig {
  baseResupplySec: number
  mechanicCrewEfficiencyPerSlot: number
  defaultHangarBossPerformance: number
  defaultMechanicCrewCount: number
  onShipRepair: OnShipRepairConfig
  launchDoorLockSec: number
  dockDoorLockSec: number
  dockApproachRadiusPx: number
  dockApproachMaxRelVel: number
  propellantDrainPerThrustSec: number
  lifeSupportDrainPerSec: number
  wingResupplyThresholdPct: number
  wingRelaunchPropellantFrac: number
  cockpitLowResourceFrac: number
  tugSpeedUnitsPerSec: number
  tugSkillThreshold: number
  tugGrappleRadiusPx: number
  tugHandoffRadiusPx: number
  ejection: EjectionConfig
}

export interface EjectionConfig {
  podDriftSpeedFrac: number
  podMaxDriftSpeed: number
  podCaptureRadiusPx: number
  podCaptureProbability: number
  podSurvivalRollPermadeath: number
  wingPodRecoveryProbability: number
  wingPodInjuryProbability: number
  permadeathDefault: boolean
  pilotInjuryConditionId: string
  pilotInjuryBodyPart: string
}

export const sortieConfig = json5.parse(raw) as SortieConfig
