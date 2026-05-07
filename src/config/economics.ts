import json5 from 'json5'
import raw from './economics.json5?raw'
import type { FactionId } from './factions'

// Per-building-type economics row. Missing fields fall back to
// `global.default*` — keeps adding a new building type a one-line config
// edit instead of a forced full row.
export interface FacilityTypeEconomics {
  baseRevenuePerShift?: number
  maintenancePerDay?: number
}

export interface OwnerKindEconomics {
  revenueMul: number
}

export interface FactionEconomics {
  revenueMul: number
  dailyStipend: number
}

export interface EconomicsConfig {
  global: {
    revenueMul: number
    defaultBaseRevenuePerShift: number
  }
  facilityTypes: Record<string, FacilityTypeEconomics>
  ownerKindMul: Record<'state' | 'character' | 'faction', OwnerKindEconomics>
  factions: Record<FactionId, FactionEconomics>
  insolvency: {
    gracePeriodDays: number
    warningHyperspeedBreak: boolean
  }
}

export const economicsConfig = json5.parse(raw) as EconomicsConfig

export function facilityRevenuePerShift(typeId: string): number {
  return economicsConfig.facilityTypes[typeId]?.baseRevenuePerShift
    ?? economicsConfig.global.defaultBaseRevenuePerShift
}

export function facilityMaintenancePerDay(typeId: string): number {
  return economicsConfig.facilityTypes[typeId]?.maintenancePerDay ?? 0
}
