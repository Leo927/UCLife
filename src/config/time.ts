import json5 from 'json5'
import raw from './time.json5?raw'

export interface TimeConfig {
  realMinPerGameDay: number
  speeds: number[]
  committedSpeed: number
  minHyperspeedRealSec: number
  maxTicksPerFrame: number
  dangerThresholds: {
    vital: number
    hp: number
  }
  autosaveCooldownRealSec: number
}

export const timeConfig = json5.parse(raw) as TimeConfig
