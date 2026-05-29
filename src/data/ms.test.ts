// Phase 6.2.5.A — MS class data is content-validated at module import.
// The import below would throw if any of those rules failed; the tests
// just pin the public surface so a regression in the loader lights up.

import { describe, expect, it } from 'vitest'
import { MS_CLASSES, MS_CLASS_LIST, getMsClass, isMsClassId, defaultMountedWeapons } from './ms'

describe('ms class loader', () => {
  it('exposes at least one MS class', () => {
    expect(MS_CLASS_LIST.length).toBeGreaterThanOrEqual(1)
  })

  it('ships the placeholder gm_pre frame', () => {
    expect(isMsClassId('gm_pre')).toBe(true)
    const ms = getMsClass('gm_pre')
    expect(ms.hullMax).toBeGreaterThan(0)
    expect(ms.topSpeed).toBeGreaterThan(60)
    expect(ms.maxAngVel).toBeGreaterThan(1.5)
  })

  it('every MS declares at least one hardpoint', () => {
    for (const ms of MS_CLASS_LIST) {
      expect(ms.hardpoints.length).toBeGreaterThan(0)
    }
  })

  it('every MS declares broker price + per-day supply (Phase 6.2.5.B)', () => {
    for (const ms of MS_CLASS_LIST) {
      expect(ms.priceFiat).toBeGreaterThanOrEqual(0)
      expect(ms.supplyPerDay).toBeGreaterThanOrEqual(0)
    }
  })

  it('every MS declares a non-negative supplyPerRepairDay (Issue #63)', () => {
    for (const ms of MS_CLASS_LIST) {
      expect(ms.supplyPerRepairDay).toBeGreaterThanOrEqual(0)
    }
  })

  it('ships the civFighter frame (Phase 6.2.5.B AE catalog)', () => {
    expect(isMsClassId('civFighter')).toBe(true)
    const ms = getMsClass('civFighter')
    expect(ms.priceFiat).toBeGreaterThan(0)
  })

  it('defaultMountedWeapons returns one entry per hardpoint', () => {
    const ms = getMsClass('gm_pre')
    const mw = defaultMountedWeapons(ms)
    expect(Object.keys(mw).length).toBe(ms.hardpoints.length)
    for (const hp of ms.hardpoints) {
      expect(mw[hp.id]).toBe(hp.defaultWeaponId)
    }
  })

  it('throws on unknown MS id', () => {
    expect(() => getMsClass('nope')).toThrow(/Unknown MS class/)
  })

  it('isMsClassId reflects the registry', () => {
    for (const id of Object.keys(MS_CLASSES)) {
      expect(isMsClassId(id)).toBe(true)
    }
    expect(isMsClassId('not-a-thing')).toBe(false)
  })
})
