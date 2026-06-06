// warState tests — the one-way gate, config-seeded strength model, idempotent
// delta application, and persistence round-trip. Pure store, no clock/loop.

import { describe, expect, it, beforeEach } from 'vitest'
import { warTransitionConfig } from '../config'
import {
  isWartime, getTransitionDay, getFactionStrength, getFrontControl,
  isWarEventResolved, flipToWartime, applyStrengthDelta, markWarEventResolved,
  snapshotWarState, restoreWarState, resetWarState,
} from './warState'

beforeEach(() => resetWarState())

describe('warState gate', () => {
  it('starts pre-war with an empty model', () => {
    expect(isWartime()).toBe(false)
    expect(getTransitionDay()).toBe(0)
    expect(getFactionStrength('federation')).toBe(0)
  })

  it('flips one-way and seeds strengths + fronts from config', () => {
    expect(flipToWartime(616)).toBe(true)
    expect(isWartime()).toBe(true)
    expect(getTransitionDay()).toBe(616)
    expect(getFactionStrength('federation'))
      .toBe(warTransitionConfig.initialFactionStrength.federation)
    const front0 = warTransitionConfig.fronts[0]
    expect(getFrontControl(front0.id)).toBe(front0.control)
  })

  it('is a no-op once already wartime (the flip happens exactly once)', () => {
    flipToWartime(616)
    applyStrengthDelta({ federation: -10 }, undefined)
    // A second flip must not re-seed (which would clobber the applied delta).
    expect(flipToWartime(999)).toBe(false)
    expect(getTransitionDay()).toBe(616)
    expect(getFactionStrength('federation'))
      .toBe(warTransitionConfig.initialFactionStrength.federation - 10)
  })
})

describe('strength deltas', () => {
  beforeEach(() => flipToWartime(616))

  it('applies faction + front deltas and clamps to bounds', () => {
    applyStrengthDelta({ federation: -5, zeon: 3 }, { side5: -20 })
    expect(getFactionStrength('federation'))
      .toBe(warTransitionConfig.initialFactionStrength.federation - 5)
    expect(getFactionStrength('zeon'))
      .toBe(warTransitionConfig.initialFactionStrength.zeon + 3)
    expect(getFrontControl('side5')).toBe(50 - 20)
  })

  it('floors faction strength at 0 and clamps front control to 0–100', () => {
    applyStrengthDelta({ federation: -10_000 }, { lunar: 10_000 })
    expect(getFactionStrength('federation')).toBe(0)
    expect(getFrontControl('lunar')).toBe(100)
  })

  it('guards war-event resolution against double-apply', () => {
    expect(isWarEventResolved('op-british-strike')).toBe(false)
    markWarEventResolved('op-british-strike')
    expect(isWarEventResolved('op-british-strike')).toBe(true)
    // Marking twice keeps a single entry.
    markWarEventResolved('op-british-strike')
    expect(snapshotWarState().resolvedEventIds).toEqual(['op-british-strike'])
  })
})

describe('persistence', () => {
  it('round-trips the full model', () => {
    flipToWartime(616)
    applyStrengthDelta({ federation: -5 }, { side5: -20 })
    markWarEventResolved('op-british-strike')
    const snap = snapshotWarState()

    resetWarState()
    expect(isWartime()).toBe(false)

    restoreWarState(snap)
    expect(isWartime()).toBe(true)
    expect(getTransitionDay()).toBe(616)
    expect(getFactionStrength('federation'))
      .toBe(warTransitionConfig.initialFactionStrength.federation - 5)
    expect(getFrontControl('side5')).toBe(30)
    expect(isWarEventResolved('op-british-strike')).toBe(true)
  })
})
