import json5 from 'json5'
import raw from './world.json5?raw'

export interface WorldConfig {
  tilePx: number
  wallThicknessPx: number
  movePxPerGameMin: number
  arriveEpsPx: number
  waypointEpsPx: number
  ranges: {
    playerInteract: number
    counterStaffed: number
    workstationOccupied: number
    npcArrive: number
    npcCounter: number
  }
  mapClickFeedback: {
    durationSec: number
    startRadiusTiles: number
    endRadiusTiles: number
    strokeWidthBase: number
    startAlpha: number
    colorCss: string
  }
  activeZone: {
    activeRadiusTiles: number
    hysteresisTiles: number
    membershipTickMin: number
    inactiveSlowFactor: number
    inactiveCoarseTickMin: number
  }
}

export const worldConfig = json5.parse(raw) as WorldConfig
