import { describe, it, expect } from 'vitest'
import { getShipClass, SHIP_CLASS_LIST } from './ship-classes'
import { jobsConfig } from '../config'

// Task 4 (W1 playable loop) — the lightFreighter is the starter hull the
// AE VB sales rep sells first. It must be reachable by a player earning a
// typical wage without turning ship ownership into a grind.
const MAX_WAGE_DAYS_TO_AFFORD = 30

function medianWageFromJobsConfig(): number {
  const wages = Object.values(jobsConfig.catalog)
    .map((spec) => spec.wage)
    .sort((a, b) => a - b)
  const mid = Math.floor(wages.length / 2)
  return wages.length % 2 === 0
    ? (wages[mid - 1] + wages[mid]) / 2
    : wages[mid]
}

describe('starter hull pricing', () => {
  it('lightFreighter is priced within a few in-game weeks of median wage income', () => {
    const cls = getShipClass('lightFreighter')
    const medianDailyWage = medianWageFromJobsConfig()
    expect(cls.priceFiat, 'starter hull must exist with a price').toBeGreaterThan(0)
    expect(
      cls.priceFiat,
      `starter hull must be reachable in <=${MAX_WAGE_DAYS_TO_AFFORD} median wage-days`,
    ).toBeLessThanOrEqual(MAX_WAGE_DAYS_TO_AFFORD * medianDailyWage)
  })
})

// Issue #165 — non-primary mounts shipped unarmed (`defaultWeapons` shorter
// than `mounts`), so a flagship's second+ hardpoint never fired outside the
// fire-control smoke's test-only `armWeaponMountForTest` workaround. Every
// class must arm every mount it declares.
describe('every ship class arms every declared mount (Issue #165)', () => {
  it.each(SHIP_CLASS_LIST.map((cls) => [cls.id, cls] as const))(
    '%s: defaultWeapons.length === mounts.length',
    (_id, cls) => {
      expect(cls.defaultWeapons.length).toBe(cls.mounts.length)
    },
  )
})
