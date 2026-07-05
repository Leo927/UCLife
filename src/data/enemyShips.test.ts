// W3 (ms-identity) Task 2 — hostile MS frames. Enemy ship rows may declare
// `isMs: true` + a `pilot` quality block; the loader validates the pair at
// import time (the import below throws first if the schema is wrong). These
// tests pin the two authored junker MS rows and the design invariant that
// they sit below the player's starter frame (gm_pre) on every combat axis.

import { describe, expect, it } from 'vitest'
import { ENEMY_SHIP_LIST, getEnemyShip, isEnemyShipId } from './enemyShips'
import { getMsClass } from './ms'

describe('enemy ship loader — isMs / pilot schema', () => {
  it('ships at least one isMs row', () => {
    const msRows = ENEMY_SHIP_LIST.filter((s) => s.isMs)
    expect(msRows.length).toBeGreaterThanOrEqual(2)
  })

  it('every isMs row declares a valid pilot quality block', () => {
    for (const s of ENEMY_SHIP_LIST) {
      if (!s.isMs) continue
      expect(s.pilot, `${s.id} is isMs but has no pilot block`).toBeTruthy()
      expect(s.pilot!.reactionSec).toBeGreaterThan(0)
      expect(s.pilot!.aimJitterRad).toBeGreaterThanOrEqual(0)
      expect(s.pilot!.boostUse).toBeGreaterThanOrEqual(0)
      expect(s.pilot!.boostUse).toBeLessThanOrEqual(1)
    }
  })

  it('no non-isMs row declares a pilot block', () => {
    for (const s of ENEMY_SHIP_LIST) {
      if (s.isMs) continue
      expect(s.pilot, `${s.id} is not isMs but declares a pilot block`).toBeUndefined()
    }
  })

  it('ships the pirate_junkerMs light-brawler frame', () => {
    expect(isEnemyShipId('pirate_junkerMs')).toBe(true)
    const ms = getEnemyShip('pirate_junkerMs')
    expect(ms.isMs).toBe(true)
    expect(ms.mounts.length).toBe(ms.defaultWeapons.length)
  })

  it('ships the pirate_junkerMs_gun fire-support frame', () => {
    expect(isEnemyShipId('pirate_junkerMs_gun')).toBe(true)
    const ms = getEnemyShip('pirate_junkerMs_gun')
    expect(ms.isMs).toBe(true)
    expect(ms.mounts.length).toBe(ms.defaultWeapons.length)
  })

  it('junker MS frames sit below gm_pre (the player starter frame) on hull/armor/topSpeed', () => {
    const gmPre = getMsClass('gm_pre')
    for (const id of ['pirate_junkerMs', 'pirate_junkerMs_gun']) {
      const ms = getEnemyShip(id)
      expect(ms.hullMax, `${id} hullMax must be below gm_pre`).toBeLessThan(gmPre.hullMax)
      expect(ms.armorMax, `${id} armorMax must be below gm_pre`).toBeLessThan(gmPre.armorMax)
      expect(ms.topSpeed, `${id} topSpeed must be below gm_pre`).toBeLessThan(gmPre.topSpeed)
    }
  })

  it('junker MS frames move at MS scale, not ship scale (topSpeed >= 120)', () => {
    for (const id of ['pirate_junkerMs', 'pirate_junkerMs_gun']) {
      expect(getEnemyShip(id).topSpeed).toBeGreaterThanOrEqual(120)
    }
  })
})
