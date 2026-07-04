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
  // Phase 6.2.A — docked-ship gate layout, dispatched per hangar tier.
  // Surface hangars use a `floor` grid (rows × cols inside the building);
  // drydock hangars use a `wall` column (one external booth column per
  // class, anchored to the building's west or east wall). See fleet.json5
  // for rationale and the offset semantics.
  hangarMarkerLayout: {
    surface: Partial<Record<'capital' | 'smallCraft', FloorGateLayout>>
    drydock: Partial<Record<'capital' | 'smallCraft', WallGateLayout>>
  }
  // Phase 6.2.C1 — ship-delivery lead times + AE VB sales-desk tile.
  delivery: {
    lightHull: number
    capital: number
  }
  shipSalesDeskTileVB: { x: number; y: number }
  // Phase 6.2.C2 — Von Braun orbital drydock concourse sales desk +
  // sales-rep catalog. The catalog maps each rep's workstation specId
  // to the list of hull classes that rep sells (rendered as one product
  // section per id, in list order).
  shipSalesDeskTileVonBraunDrydock: { x: number; y: number }
  salesRepCatalog: Record<string, { shipClassIds: string[] }>
  // Phase 6.2.5.B — vehicle (MS / fighter / MW) broker desk + catalog +
  // delivery lead time. The catalog maps each vehicle rep's workstation
  // specId to the MS class that rep sells.
  vehicleSalesDeskTileVB: { x: number; y: number }
  vehicleSalesRepCatalog: Record<string, { msClassIds: string[] }>
  vehicleDeliveryDays: number
  // Issue #64 — AE MS-parts broker. Desk tile + per-dealer catalog of
  // weapon / frame-mod ids + linear price-derivation constants. Parts buy
  // immediately into PlayerPartsInventory (no delivery queue / hangar slot).
  partsSalesDeskTileVB: { x: number; y: number }
  partsSalesCatalog: Record<string, { weapons: string[]; frameMods: string[] }>
  partsPricing: {
    weaponBasePrice: number
    weaponPricePerDamage: number
    frameModBasePrice: number
    frameModPricePerSlot: number
  }
  // Phase 6.2.D — hire economics + captain Effect + auto-man limit.
  hireCaptainSigningFee: number
  hireCrewSigningFee: number
  captainSalaryBonus: number
  // Phase 6.2.5.B — hire-as-pilot signing bonus + per-day salary bonus.
  hirePilotSigningFee: number
  pilotSalaryBonus: number
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
  aggressionLevels: {
    id: string
    labelZh: string
    aiAggression: number
    // Issue #69 — doctrine reads through tactical AI.
    maintainRangeMul: number
    retreatThresholdMul: number
  }[]
  aggressionDefault: string
  // Issue #69 — Command Points (in-engagement comm bandwidth).
  commandPoints: {
    base: number
    playerCommandSkill: string
    shipCommandDivisor: number
    playerTacticsSkill: string
    tacticsDivisor: number
    commOfficerSkill: string
    commOfficerDivisor: number
    maxPoolCap: number
    regenPerSec: number
    dailyRefillFraction: number
    orderCosts: Record<string, number>
  }
  // Issue #69 — Deployment Points (pre-engagement budget).
  deploymentPoints: {
    base: number
    playerCommandSkill: string
    shipCommandPerDp: number
    commOfficerSkill: string
    commOfficerPerDp: number
    maxCapCap: number
  }
  // Phase 6.2.E2 — formation slot offsets + cross-POI transit + transit fee.
  formationSlotOffsets: Record<string, { dx: number; dy: number }>
  transitDaysDefault: number
  transitDays: Record<string, number>
  transitFee: number
  // Phase 6.2.G — paid-and-delayed transfer-to-other-hangar fee table.
  transferFeeDefault: number
  transferFees: Record<string, number>
  // Phase 6.2.5.B — paid-and-delayed MS transfer between hangars.
  msTransferFeeDefault: number
  msTransferFees: Record<string, number>
  msTransitDaysDefault: number
  msTransitDays: Record<string, number>
  // Phase 6.2.H — debug "grant fleet" function knobs.
  grantFleet: {
    moneyGrant: number
    npcPoolSize: number
    deliveryLeadDays: number
  }
  // Ship-naming defaults. Generated names follow
  // `${cls.nameZh} ${shipNamePrefix}${seq.padStart(shipNamePadDigits, '0')}`.
  shipNamePrefix: string
  shipNamePadDigits: number
  // Class-prefix used in gate ids: `${prefix}${1..N}` where N is the slot
  // count for that class in hangarMarkerLayout.
  gatePrefixCapital: string
  gatePrefixSmallCraft: string
  // Issue #71 — recoverables (post-combat hull / pod recovery).
  recoverables: RecoverablesConfig
}

export interface HullTierSalvageYield {
  supplies: number
  fuel: number
  credits: number
}

export interface RecoverablesConfig {
  // Supply cost per recovered hull, keyed by hangarSlotClass tier.
  salvageRecoverSupplyCost: Record<string, number>
  prizeCrewDivisor: number
  // Break-down yields, keyed by hangarSlotClass tier.
  salvageYield: Record<string, HullTierSalvageYield>
}

interface BoothShape {
  signTemplate:        string
  signOffsetTiles:     { x: number; y: number }
  terminalOffsetTiles: { x: number; y: number }
  boardOffsetTiles:    { x: number; y: number }
}

export interface FloorGateLayout extends BoothShape {
  placement: 'floor'
  rowOffsetsTiles: number[]
  strideTiles: number
  startTileX: number
}

export interface WallGateLayout extends BoothShape {
  placement: 'wall'
  side: 'w' | 'e'
  rowOffsetsTiles: number[]
}

export type GateLayout = FloorGateLayout | WallGateLayout

export const fleetConfig = json5.parse(raw) as FleetConfig
