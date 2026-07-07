import json5 from 'json5'
import raw from './crew.json5?raw'

export interface HourWindow {
  startHour: number
  endHour: number
}

export interface CrewConfig {
  duty: {
    mealWindows: HourWindow[]
    sleepWindow: HourWindow
    arriveRadiusPx: number
  }
  mess: {
    mealSupplyCost: number
  }
  bunk: {
    claimHours: number
  }
}

export const crewConfig = json5.parse(raw) as CrewConfig
