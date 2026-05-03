import { getPoi, burnCost } from '../data/starmap'
import {
  getShipState, spendFuel, spendSupplies, setDockedPoi, setFleetPos,
  clearDocked, getDockedPoiId,
} from '../sim/ship'
import { useClock } from '../sim/clock'
import { runTransition, useTransition } from '../sim/transition'
import { useUI } from '../ui/uiStore'
import { useEventLog } from '../ui/EventLog'
import { triggerEncounterAtPoi } from '../sim/encounters'

// Phase 6.0 starmap travel: Starsector-shape continuous 2D burns. The
// player picks a destination POI on the map; the system validates fuel
// + supplies, runs the shared fade transition, and at the midpoint
// spends the resources, advances the in-game clock by the burn duration,
// snaps the fleet to the destination, and fires an encounter.
//
// In-transit encounters along the burn line are a Phase 6.1 hook —
// arrival-only is enough for the 6.0 demo moment.

export type BurnFailReason =
  | 'no-ship'
  | 'not-docked'
  | 'unknown-poi'
  | 'insufficient-fuel'
  | 'insufficient-supplies'
  | 'in-transition'
  | 'same-poi'

export interface BurnResult {
  ok: boolean
  reason?: BurnFailReason
}

export function canBurnTo(poiId: string): BurnResult {
  if (useTransition.getState().inProgress) return { ok: false, reason: 'in-transition' }
  const ship = getShipState()
  if (!ship) return { ok: false, reason: 'no-ship' }
  const from = getDockedPoiId()
  if (!from) return { ok: false, reason: 'not-docked' }
  if (from === poiId) return { ok: false, reason: 'same-poi' }
  const dest = getPoi(poiId)
  if (!dest) return { ok: false, reason: 'unknown-poi' }
  const cost = burnCost(from, poiId)
  if (ship.fuelCurrent < cost.fuel) return { ok: false, reason: 'insufficient-fuel' }
  if (ship.suppliesCurrent < cost.supplies) return { ok: false, reason: 'insufficient-supplies' }
  return { ok: true }
}

const FAIL_REASON_MSG: Record<BurnFailReason, string> = {
  'no-ship': '没有飞船',
  'not-docked': '飞船未在停靠点',
  'unknown-poi': '未知坐标',
  'insufficient-fuel': '燃料不足',
  'insufficient-supplies': '补给不足',
  'in-transition': '正在航行中',
  'same-poi': '已在此处',
}

export async function burnTo(poiId: string): Promise<void> {
  const check = canBurnTo(poiId)
  if (!check.ok) {
    useUI.getState().showToast(FAIL_REASON_MSG[check.reason!])
    return
  }

  const fromId = getDockedPoiId()!
  const cost = burnCost(fromId, poiId)
  const dest = getPoi(poiId)!
  useUI.getState().setStarmap(false)

  await runTransition({
    midpoint: () => {
      spendFuel(cost.fuel)
      spendSupplies(cost.supplies)
      useClock.getState().advance(cost.durationMin)
      // Mark the fleet as in-flight just long enough for the encounter
      // dispatcher to know the player is mid-burn; arrival immediately
      // re-docks at the destination POI.
      clearDocked()
      setFleetPos(dest.pos)
      setDockedPoi(poiId, dest.pos)
      const ms = useClock.getState().gameDate.getTime()
      useEventLog.getState().push(`抵达 ${dest.nameZh}`, ms)
      triggerEncounterAtPoi(poiId)
    },
    outMs: 600,
    inMs: 600,
  })
}
