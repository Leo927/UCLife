import {
  burnCostBetween, type MapPos, getPoi, distancePos,
} from '../data/starmap'
import {
  getShipState, spendFuel, spendSupplies, setDockedPoi, setFleetPos,
  clearDocked, getDockedPoiId, getBurnPlan, setBurnPlan,
} from '../sim/ship'
import { useClock } from '../sim/clock'
import { useTransition } from '../sim/transition'
import { useUI } from '../ui/uiStore'
import { useEventLog } from '../ui/EventLog'
import { triggerEncounterAtPoi } from '../sim/encounters'

// Phase 6.0 starmap travel: Starsector-shape continuous 2D burns. The
// player picks a destination on the campaign map (free space or any POI);
// the system validates fuel + supplies, debits them upfront, sets a burn
// plan on the ship, and the per-tick `tickStarmap` interpolates fleetPos
// from origin to destination over the burn's game-time duration. The
// fleet token is visible in transit so the player watches it move
// (Starsector pattern, not the previous fade-then-teleport node hop).
//
// In-transit encounters along the burn line are a Phase 6.1 hook —
// arrival-only is enough for the 6.0 demo moment.

export type BurnFailReason =
  | 'no-ship'
  | 'no-origin'
  | 'unknown-poi'
  | 'insufficient-fuel'
  | 'insufficient-supplies'
  | 'in-transition'
  | 'in-burn'
  | 'too-close'

export interface BurnResult {
  ok: boolean
  reason?: BurnFailReason
}

const MIN_BURN_DISTANCE = 0.5  // normalized map units; clicks closer than this are no-ops

export function canBurnToPos(target: MapPos): BurnResult {
  if (useTransition.getState().inProgress) return { ok: false, reason: 'in-transition' }
  const ship = getShipState()
  if (!ship) return { ok: false, reason: 'no-ship' }
  if (ship.burnPlan) return { ok: false, reason: 'in-burn' }
  const from = currentFleetPos()
  if (!from) return { ok: false, reason: 'no-origin' }
  if (distancePos(from, target) < MIN_BURN_DISTANCE) {
    return { ok: false, reason: 'too-close' }
  }
  const cost = burnCostBetween(from, target)
  if (ship.fuelCurrent < cost.fuel) return { ok: false, reason: 'insufficient-fuel' }
  if (ship.suppliesCurrent < cost.supplies) return { ok: false, reason: 'insufficient-supplies' }
  return { ok: true }
}

export function canBurnToPoi(poiId: string): BurnResult {
  const dest = getPoi(poiId)
  if (!dest) return { ok: false, reason: 'unknown-poi' }
  if (poiId === getDockedPoiId()) return { ok: false, reason: 'too-close' }
  return canBurnToPos(dest.pos)
}

const FAIL_REASON_MSG: Record<BurnFailReason, string> = {
  'no-ship': '没有飞船',
  'no-origin': '舰队位置未知',
  'unknown-poi': '未知坐标',
  'insufficient-fuel': '燃料不足',
  'insufficient-supplies': '补给不足',
  'in-transition': '正在切换场景',
  'in-burn': '正在航行中',
  'too-close': '距离过近',
}

function currentFleetPos(): MapPos | null {
  const ship = getShipState()
  if (!ship) return null
  // Docked + at a known POI -> read from the POI (handles legacy saves whose
  // fleetPos may lag behind dockedAtPoiId).
  if (ship.dockedAtPoiId) {
    const docked = getPoi(ship.dockedAtPoiId)
    if (docked) return docked.pos
  }
  return { x: ship.fleetPos.x, y: ship.fleetPos.y }
}

export function burnToPos(target: MapPos, destPoiId: string | null = null): void {
  const check = canBurnToPos(target)
  if (!check.ok) {
    useUI.getState().showToast(FAIL_REASON_MSG[check.reason!])
    return
  }

  const from = currentFleetPos()!
  const cost = burnCostBetween(from, target)
  spendFuel(cost.fuel)
  spendSupplies(cost.supplies)

  // Detach from any docked POI so the encounter dispatcher and UI know the
  // fleet is mid-burn. fleetPos snaps to origin so the very first tick of
  // tickStarmap starts the lerp from the right place.
  clearDocked()
  setFleetPos(from)

  const startedAtMs = useClock.getState().gameDate.getTime()
  const arriveAtMs = startedAtMs + cost.durationMin * 60_000
  setBurnPlan({
    fromX: from.x, fromY: from.y,
    toX: target.x, toY: target.y,
    startedAtMs,
    arriveAtMs,
    destPoiId,
  })
}

export function burnToPoi(poiId: string): void {
  const check = canBurnToPoi(poiId)
  if (!check.ok) {
    useUI.getState().showToast(FAIL_REASON_MSG[check.reason!])
    return
  }
  const dest = getPoi(poiId)!
  burnToPos(dest.pos, poiId)
}

// Per-tick starmap update. Reads the active burn plan, lerps fleetPos to
// the current game-time, and on completion docks (if destPoiId set) +
// fires the arrival encounter. Cheap when no burn is active.
export function starmapSystem(): void {
  const plan = getBurnPlan()
  if (!plan) return
  const now = useClock.getState().gameDate.getTime()
  const span = Math.max(1, plan.arriveAtMs - plan.startedAtMs)
  const t = Math.max(0, Math.min(1, (now - plan.startedAtMs) / span))
  const x = plan.fromX + (plan.toX - plan.fromX) * t
  const y = plan.fromY + (plan.toY - plan.fromY) * t
  setFleetPos({ x, y })

  if (t >= 1) {
    setBurnPlan(null)
    if (plan.destPoiId) {
      const dest = getPoi(plan.destPoiId)
      if (dest) {
        setDockedPoi(plan.destPoiId, dest.pos)
        useEventLog.getState().push(`抵达 ${dest.nameZh}`, now)
        triggerEncounterAtPoi(plan.destPoiId)
        return
      }
    }
    useEventLog.getState().push('抵达目标坐标', now)
  }
}

export function getBurnProgress(): number | null {
  const plan = getBurnPlan()
  if (!plan) return null
  const now = useClock.getState().gameDate.getTime()
  const span = Math.max(1, plan.arriveAtMs - plan.startedAtMs)
  return Math.max(0, Math.min(1, (now - plan.startedAtMs) / span))
}

// Test/debug helper: jumps the game-clock to the burn's arrival time and
// runs one starmap tick. The tick handles fleet snap, POI dock, encounter
// trigger. Returns true iff a burn was active and got completed.
export function forceCompleteBurn(): boolean {
  const plan = getBurnPlan()
  if (!plan) return false
  const now = useClock.getState().gameDate.getTime()
  const skip = Math.max(0, plan.arriveAtMs - now)
  if (skip > 0) useClock.getState().advance(skip / 60_000)
  starmapSystem()
  return true
}
