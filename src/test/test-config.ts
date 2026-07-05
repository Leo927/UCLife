import json5 from 'json5'
import raw from './test-config.json5?raw'

export interface TestConfig {
  tickGameMs: number
  defaultStartIso: string
  defaultSeed: string
  maxStepTicks: number
  msPerGameMinute: number
  msPerGameSecond: number
  walkClickMarginPx: number
  spaceClickInsetPx: number
  coarseSliceGameMs: number
}

export const testConfig = json5.parse(raw) as TestConfig
