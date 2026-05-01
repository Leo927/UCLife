import { economyConfig, jobsConfig } from '../config'
import type { JobSpec } from '../config'

const DOW_LABEL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function dowLabel(dow: number): string {
  return DOW_LABEL[dow] ?? ''
}

export function getJobSpec(specId: string): JobSpec | null {
  return jobsConfig.catalog[specId] ?? null
}

export function allJobSpecs(): { id: string; spec: JobSpec }[] {
  return Object.entries(jobsConfig.catalog).map(([id, spec]) => ({ id, spec }))
}

export function isWorkDay(date: Date, spec: JobSpec): boolean {
  return spec.workDays.includes(date.getDay())
}

export function isInWorkWindow(date: Date, spec: JobSpec): boolean {
  if (!isWorkDay(date, spec)) return false
  const m = date.getHours() * 60 + date.getMinutes()
  return m >= spec.shiftStart * 60 && m < spec.shiftEnd * 60
}

export const isWorkDayWS = isWorkDay
export const isInWorkWindowWS = isInWorkWindow

// Piecewise wage curve over perf (0..100):
//   perf >= fullPay         → 1.0
//   nearFull..fullPay       → 1.0 - (100 - perf) * nearFullSlope
//   midRange..nearFull      → midRangeBaseMult - (nearFull - perf) * midRangeSlope
//   below midRange          → max(0, perf * lowSlope)
export function wageMultiplier(perf: number): number {
  const w = economyConfig.wage
  const { fullPay, nearFull, midRange } = w.perfBreakpoints
  const { nearFull: nearSlope, midRange: midSlope, low: lowSlope } = w.perfSlopes
  if (perf >= fullPay) return 1.0
  if (perf >= nearFull) return 1.0 - (fullPay - perf) * nearSlope
  if (perf >= midRange) return w.midRangeBaseMult - (nearFull - perf) * midSlope
  return Math.max(0, perf * lowSlope)
}
