import json5 from 'json5'
import raw from './fleet.json5?raw'

export interface FleetConfig {
  baseRepairPerWorker: number
  managerScaleMin: number
  managerScaleMax: number
  perfMin: number
  perfMax: number
  // Phase 6.2.F — supply / fuel economy. See fleet.json5 for rationale.
  supplyOrderQuantum: number
  supplyPricePerUnit: number
  fuelPricePerUnit: number
  supplyDeliveryDays: number
  fuelDeliveryDays: number
  secretaryBulkOrderMarkup: number
  secretaryBulkOrderDeliveryDays: number
  // Phase 6.2.C1 — ship-delivery lead times + AE VB sales-desk tile.
  delivery: {
    lightHull: number
    capital: number
  }
  shipSalesDeskTileVB: { x: number; y: number }
  // Phase 6.2.C2 — Granada drydock concourse sales desk + sales-rep
  // catalog. The catalog maps each rep's workstation specId to the
  // single hull class that rep sells.
  shipSalesDeskTileGranada: { x: number; y: number }
  salesRepCatalog: Record<string, { shipClassId: string }>
  // Phase 6.2.D — hire economics + captain Effect + auto-man limit.
  hireCaptainSigningFee: number
  hireCrewSigningFee: number
  captainDailySalary: number
  crewDailySalary: number
  captainEffectSkill: string
  captainEffectStat: string
  captainEffectPerLevel: number
  manFromIdlePoolMaxPerClick: number
  // Phase 6.2.E1 — war-room formation grid + aggression doctrine list.
  activeFleetGrid: {
    cols: number
    rows: number
    flagshipSlot: number
  }
  aggressionLevels: { id: string; labelZh: string }[]
  aggressionDefault: string
}

export const fleetConfig = json5.parse(raw) as FleetConfig
