// Phase 6.1 — MS class data is content-validated at module import (see
// ms.ts validators: hull > 0, weapons resolve, mount sizes fit). The
// import below would throw if any of those rules failed; the tests just
// pin the public surface so a regression in the loader (or a content
// edit that strips a required field) lights up here.

import { describe, expect, it } from 'vitest'
import { MS_CLASSES, MS_CLASS_LIST, getMsClass, isMsClassId } from './ms'

describe('ms class loader', () => {
  it('exposes at least one MS class for Phase 6.1 launch', () => {
    expect(MS_CLASS_LIST.length).toBeGreaterThanOrEqual(1)
  })

  it('ships the placeholder gm_pre frame the cockpit module spawns', () => {
    expect(isMsClassId('gm_pre')).toBe(true)
    const ms = getMsClass('gm_pre')
    expect(ms.hullMax).toBeGreaterThan(0)
    // Phase 6.1 commits to MS being faster + more agile than the light
    // freighter (60 / 4) so the cockpit feels distinct from the bridge.
    expect(ms.topSpeed).toBeGreaterThan(60)
    expect(ms.maxAngVel).toBeGreaterThan(1.5)
  })

  it('every MS declares at least one weapon (no per-MS ammo in 6.1)', () => {
    for (const ms of MS_CLASS_LIST) {
      expect(ms.weapons.length).toBeGreaterThan(0)
    }
  })

  it('throws on unknown MS id — failing loud beats silently substituting', () => {
    expect(() => getMsClass('nope')).toThrow(/Unknown MS class/)
  })

  it('isMsClassId reflects the registry', () => {
    for (const id of Object.keys(MS_CLASSES)) {
      expect(isMsClassId(id)).toBe(true)
    }
    expect(isMsClassId('not-a-thing')).toBe(false)
  })
})
