// Phase 6.3.B — colony economics debug handles.
// Exposes per-colony state for deterministic smoke tests without going
// through the UI. All handles are gated behind DEV mode in bootProd.tsx.

import { registerDebugHandle } from '../../debug/uclifeHandle'
import {
  getColonyEconomics, setColonyEconomics,
  addColonyWarehouseItem, isPlayerColony,
  type WarehouseItem,
} from '../../sim/colony'
import { colonyEconomicsSystem, colonyResupplyFromHangar } from '../../systems/colonyEconomics'
import { gameDayNumber, useClock } from '../../sim/clock'
import { fleetConfig, recruitmentConfig, colonyConfig } from '../../config'

export interface ColonyEconomicsSnapshot {
  poiId: string
  stabilityScore: number
  accumulatedIncome: number
  warehouseContents: WarehouseItem[]
  lastRolloverDay: number
}

registerDebugHandle('colonyEconomicsSnapshot', (poiId: string): ColonyEconomicsSnapshot | null => {
  if (!isPlayerColony(poiId)) return null
  const econ = getColonyEconomics(poiId)
  if (!econ) return null
  return { poiId, ...econ }
})

interface RolloverResult {
  day: number
  coloniesProcessed: number
  totalIncomeCredit: number
}

registerDebugHandle('forceColonyEconomics', (gameDay?: number): RolloverResult => {
  const day = gameDay ?? gameDayNumber(useClock.getState().gameDate)
  const r = colonyEconomicsSystem(day)
  return { day, ...r }
})

// Reset the lastRolloverDay guard so a forced rollover fires even if the
// same day was already processed. Smoke tests that need multiple rollovers
// within one clock-day use this between calls to forceColonyEconomics.
registerDebugHandle('colonyResetRolloverDay', (poiId: string): { ok: boolean } => {
  const econ = getColonyEconomics(poiId)
  if (!econ) return { ok: false }
  setColonyEconomics(poiId, { ...econ, lastRolloverDay: 0 })
  return { ok: true }
})

interface ResupplyResult {
  ok: boolean
  unitsTransferred: number
  creditCharged: number
  aeEquivalentCost: number
  reason?: string
}

// Transfer supply or fuel from the colony's hangar reserve to a notional
// account. Returns how much was charged vs. the AE dealer price for the
// same quantity — the smoke test asserts creditCharged < aeEquivalentCost.
registerDebugHandle(
  'colonyResupply',
  (poiId: string, kind: 'supply' | 'fuel', qty: number): ResupplyResult => {
    const unitPrice = kind === 'supply' ? fleetConfig.supplyPricePerUnit : fleetConfig.fuelPricePerUnit
    const r = colonyResupplyFromHangar(poiId, kind, qty)
    return {
      ...r,
      aeEquivalentCost: unitPrice * qty,
    }
  },
)

interface StoreItemResult {
  ok: boolean
  reason?: string
}

registerDebugHandle(
  'colonyStoreItem',
  (poiId: string, item: WarehouseItem): StoreItemResult => {
    if (!isPlayerColony(poiId)) return { ok: false, reason: 'not a player colony' }
    addColonyWarehouseItem(poiId, item)
    return { ok: true }
  },
)

// Preview the effective hire terms that talkHire would apply when in the
// given colony — lets the smoke test verify the discount + loyalty bonus
// without driving the dialogue UI.
interface HirePreviewResult {
  inColony: boolean
  standardSigningBonus: number
  effectiveSigningBonus: number
  baseOpinionBonusOnAccept: number
  colonyOpinionBonusOnAccept: number
}

registerDebugHandle('colonyHirePreview', (poiId: string): HirePreviewResult => {
  const inColony = isPlayerColony(poiId)
  const standardBonus = recruitmentConfig.talkVerbHire.signingBonus
  const effectiveBonus = inColony
    ? Math.round(standardBonus * (1 - colonyConfig.recruitment.colonySigningFeeDiscount))
    : standardBonus
  const baseOpinionBonus = 10
  return {
    inColony,
    standardSigningBonus: standardBonus,
    effectiveSigningBonus: effectiveBonus,
    baseOpinionBonusOnAccept: baseOpinionBonus,
    colonyOpinionBonusOnAccept: inColony
      ? baseOpinionBonus + colonyConfig.recruitment.colonyLoyaltyBonus
      : baseOpinionBonus,
  }
})
