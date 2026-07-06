import json5 from 'json5'
import raw from './sortie.json5?raw'

export interface SortieConfig {
  baseResupplySec: number
  mechanicCrewEfficiencyPerSlot: number
  defaultHangarBossPerformance: number
  defaultMechanicCrewCount: number
  launchDoorLockSec: number
  dockDoorLockSec: number
  dockApproachRadiusPx: number
  dockApproachMaxRelVel: number
  propellantDrainPerThrustSec: number
  lifeSupportDrainPerSec: number
  wingResupplyThresholdPct: number
  wingRelaunchPropellantFrac: number
  tugSpeedUnitsPerSec: number
  tugSkillThreshold: number
  tugGrappleRadiusPx: number
  tugHandoffRadiusPx: number
}

export const sortieConfig = json5.parse(raw) as SortieConfig
