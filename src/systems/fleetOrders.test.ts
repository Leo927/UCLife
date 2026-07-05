import { describe, expect, it, beforeEach } from 'vitest'
import {
  issueRally, issueFocusFire, issueRegroup, activeOrders, resetFleetOrders,
} from './fleetOrders'
import { useCpDp } from './fleetCommandPoints'
import { fleetConfig } from '../config'

const RALLY_COST = fleetConfig.commandPoints.orderCosts.rally
const FOCUS_COST = fleetConfig.commandPoints.orderCosts.focusFire
const REGROUP_COST = fleetConfig.commandPoints.orderCosts.formationChange

describe('fleetOrders — rally', () => {
  beforeEach(() => {
    useCpDp.getState().reset()
    resetFleetOrders()
  })

  it('sets rallyPoint and debits CP when the pool can cover the cost', () => {
    useCpDp.getState().setCp(RALLY_COST, RALLY_COST)
    const r = issueRally({ x: 10, y: 20 })
    expect(r.ok).toBe(true)
    expect(activeOrders().rallyPoint).toEqual({ x: 10, y: 20 })
    expect(useCpDp.getState().cpCurrent).toBe(0)
  })

  it('refuses and leaves rallyPoint unchanged when CP is insufficient', () => {
    useCpDp.getState().setCp(0, RALLY_COST)
    const r = issueRally({ x: 10, y: 20 })
    expect(r.ok).toBe(false)
    expect(activeOrders().rallyPoint).toBeNull()
  })

  it('leaves a prior rallyPoint unchanged on a later refusal', () => {
    useCpDp.getState().setCp(RALLY_COST, RALLY_COST)
    issueRally({ x: 1, y: 1 })
    useCpDp.getState().setCp(0, RALLY_COST)
    const r = issueRally({ x: 99, y: 99 })
    expect(r.ok).toBe(false)
    expect(activeOrders().rallyPoint).toEqual({ x: 1, y: 1 })
  })
})

describe('fleetOrders — focus fire', () => {
  beforeEach(() => {
    useCpDp.getState().reset()
    resetFleetOrders()
  })

  it('stores the enemy key and debits CP on success', () => {
    useCpDp.getState().setCp(FOCUS_COST, FOCUS_COST)
    const r = issueFocusFire('enemy-ship-0')
    expect(r.ok).toBe(true)
    expect(activeOrders().focusTargetKey).toBe('enemy-ship-0')
  })

  it('refuses and leaves focusTargetKey unchanged when CP is insufficient', () => {
    useCpDp.getState().setCp(0, FOCUS_COST)
    const r = issueFocusFire('enemy-ship-0')
    expect(r.ok).toBe(false)
    expect(activeOrders().focusTargetKey).toBeNull()
  })
})

describe('fleetOrders — regroup', () => {
  beforeEach(() => {
    useCpDp.getState().reset()
    resetFleetOrders()
  })

  it('clears both rally and focus-fire on success', () => {
    const total = RALLY_COST + FOCUS_COST + REGROUP_COST
    useCpDp.getState().setCp(total, total)
    issueRally({ x: 5, y: 5 })
    issueFocusFire('enemy-ship-0')
    const r = issueRegroup()
    expect(r.ok).toBe(true)
    expect(activeOrders()).toEqual({ rallyPoint: null, focusTargetKey: null })
  })

  it('refuses without clearing standing orders when CP is insufficient', () => {
    useCpDp.getState().setCp(RALLY_COST, RALLY_COST)
    issueRally({ x: 5, y: 5 })
    useCpDp.getState().setCp(0, REGROUP_COST - 1)
    const r = issueRegroup()
    expect(r.ok).toBe(false)
    expect(activeOrders().rallyPoint).toEqual({ x: 5, y: 5 })
  })
})

describe('fleetOrders — reset', () => {
  it('clears all standing orders regardless of CP', () => {
    useCpDp.getState().setCp(10, 10)
    issueRally({ x: 5, y: 5 })
    issueFocusFire('enemy-ship-0')
    resetFleetOrders()
    expect(activeOrders()).toEqual({ rallyPoint: null, focusTargetKey: null })
  })
})
