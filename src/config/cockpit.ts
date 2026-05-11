import json5 from 'json5'
import raw from './cockpit.json5?raw'

export interface CockpitConfig {
  launchOffset: { x: number; y: number }
  launchVelocity: { x: number; y: number }
  dockApproachRadiusPx: number
  dockApproachMaxRelVel: number
  msHullEjectFloor: number
}

export const cockpitConfig = json5.parse(raw) as CockpitConfig
