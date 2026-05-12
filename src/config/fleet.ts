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
}

export const fleetConfig = json5.parse(raw) as FleetConfig
