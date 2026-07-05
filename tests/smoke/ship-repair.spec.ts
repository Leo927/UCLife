// ship-repair smoke. Verifies:
//  1. Flagship spawns with a ShipStatSheet whose bases match lightFreighter.
//  2. Damage via damageFlagship persists.
//  3. VB state hangar produces non-zero daily throughput once staffed.
//  4. Repair-priority focuses throughput; auto-clears when fully repaired.
//  5. Save round-trip preserves ShipStatSheet, hull/armor, repair priority.

import { test, expect } from './_fixtures'

const EXPECTED_HULL_BASE = 800
const EXPECTED_ARMOR_BASE = 200
const EXPECTED_TOP_SPEED = 60
const EXPECTED_BRIG = 2
const EXPECTED_CREW_REQUIRED = 4
const EXPECTED_FUEL_STORAGE = 16
const EXPECTED_SUPPLY_STORAGE = 40

const FIRST_DAMAGE_HULL = 600
const FIRST_DAMAGE_ARMOR = 150
const FIRST_TICK_DAY = 1
const SECOND_DAMAGE_HULL = 300
const SECOND_DAMAGE_ARMOR = 80
const MAX_REPAIR_TICKS = 20

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.listHangars',
  '__uclife__.flagshipStatSheet',
  '__uclife__.flagshipDamage',
  '__uclife__.damageFlagship',
  '__uclife__.setHangarRepairPriority',
  '__uclife__.hangarRepairDescribe',
  '__uclife__.runHangarRepairTick',
  '__uclife__.fillJobVacancies',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
]

test('ship repair: damage, throughput, focus priority, save round-trip', async ({ sim }) => {
  await sim.boot({ fixture: 'starter-fleet', requireHandles: REQUIRED_HANDLES })

  const sheet = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.flagshipStatSheet(),
  )
  expect(sheet, 'flagshipStatSheet() returned null at boot').toBeTruthy()
  expect(sheet.hullPoints).toBe(EXPECTED_HULL_BASE)
  expect(sheet.armorPoints).toBe(EXPECTED_ARMOR_BASE)
  expect(sheet.topSpeed).toBe(EXPECTED_TOP_SPEED)
  expect(sheet.brigCapacity).toBe(EXPECTED_BRIG)
  expect(sheet.crewRequired).toBe(EXPECTED_CREW_REQUIRED)
  expect(sheet.fuelStorage).toBe(EXPECTED_FUEL_STORAGE)
  expect(sheet.supplyStorage).toBe(EXPECTED_SUPPLY_STORAGE)

  const hangars = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listHangars(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vb = hangars.find((h: any) => h.typeId === 'hangarSurface')
  expect(vb, 'VB state hangar missing').toBeTruthy()

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fillJobVacancies(['hangar_manager', 'hangar_worker']),
  )
  const seated = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listHangars(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vbSeated = seated.find((h: any) => h.buildingKey === vb.buildingKey)
  expect(vbSeated?.manager, 'manager seat empty after fillJobVacancies').toBeTruthy()
  expect(vbSeated.workersSeated).toBeGreaterThanOrEqual(1)

  const initialDesc = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarRepairDescribe(k),
    vb.buildingKey,
  )
  expect(initialDesc, 'hangarRepairDescribe returned null at boot').toBeTruthy()
  expect(initialDesc.throughput).toBeGreaterThan(0)

  const before = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.flagshipDamage(),
  )
  expect(before, 'flagshipDamage() returned null at boot').toBeTruthy()

  const damaged = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (p) => (window as any).__uclife__.damageFlagship(p.hull, p.armor),
    { hull: FIRST_DAMAGE_HULL, armor: FIRST_DAMAGE_ARMOR },
  )
  expect(damaged, 'damageFlagship() returned null').toBeTruthy()
  expect(damaged.hullCurrent).toBe(before.hullCurrent - FIRST_DAMAGE_HULL)
  expect(damaged.armorCurrent).toBe(before.armorCurrent - FIRST_DAMAGE_ARMOR)

  const beforeTick = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.flagshipDamage(),
  )
  const tickResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d) => (window as any).__uclife__.runHangarRepairTick(d),
    FIRST_TICK_DAY,
  )
  expect(tickResult, 'runHangarRepairTick returned null').toBeTruthy()
  expect(tickResult.hangarsTicked).toBe(1)
  expect(tickResult.pointsApplied).toBeGreaterThan(0)

  const afterTick = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.flagshipDamage(),
  )
  const totalRestored =
    (afterTick.armorCurrent - beforeTick.armorCurrent)
    + (afterTick.hullCurrent - beforeTick.hullCurrent)
  expect(totalRestored, `no repair progress on tick1`).toBeGreaterThan(0)
  if (afterTick.armorCurrent <= beforeTick.armorCurrent && afterTick.hullCurrent > beforeTick.hullCurrent) {
    throw new Error('hull repaired before armor — should be armor-first')
  }

  const setRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.setHangarRepairPriority(k, 'ship'),
    vb.buildingKey,
  )
  expect(setRes).toBe('ship')

  const focusedDesc = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarRepairDescribe(k),
    vb.buildingKey,
  )
  expect(focusedDesc.priorityShipKey).toBe('ship')

  let ticks = 0
  let final = afterTick
  while (ticks < MAX_REPAIR_TICKS) {
    ticks += 1
    await sim.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (d) => (window as any).__uclife__.runHangarRepairTick(d),
      ticks + 1,
    )
    final = await sim.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__uclife__.flagshipDamage(),
    )
    if (final.hullCurrent >= final.hullMax && final.armorCurrent >= final.armorMax) break
  }
  expect(
    final.hullCurrent >= final.hullMax && final.armorCurrent >= final.armorMax,
    `flagship not fully repaired after ${ticks} ticks`,
  ).toBeTruthy()

  const clearedDesc = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarRepairDescribe(k),
    vb.buildingKey,
  )
  expect(clearedDesc.priorityShipKey, `priorityShipKey should auto-clear after full repair`).toBe('')

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (p) => (window as any).__uclife__.damageFlagship(p.hull, p.armor),
    { hull: SECOND_DAMAGE_HULL, armor: SECOND_DAMAGE_ARMOR },
  )
  const setBack = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.setHangarRepairPriority(k, 'ship'),
    vb.buildingKey,
  )
  expect(setBack).toBe('ship')

  const preSave = await sim.page.evaluate(
    (k) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any
      return {
        damage: w.__uclife__.flagshipDamage(),
        sheet: w.__uclife__.flagshipStatSheet(),
        desc: w.__uclife__.hangarRepairDescribe(k),
      }
    },
    vb.buildingKey,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(async () => { await (window as any).__uclife__.saveGame('auto') })
  const loadOk = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async () => (window as any).__uclife__.loadGame('auto'),
  )
  expect(loadOk.ok, `loadGame failed: ${JSON.stringify(loadOk)}`).toBe(true)

  const postLoad = await sim.page.evaluate(
    (k) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any
      return {
        damage: w.__uclife__.flagshipDamage(),
        sheet: w.__uclife__.flagshipStatSheet(),
        desc: w.__uclife__.hangarRepairDescribe(k),
      }
    },
    vb.buildingKey,
  )
  expect(postLoad.damage.hullCurrent).toBe(preSave.damage.hullCurrent)
  expect(postLoad.damage.armorCurrent).toBe(preSave.damage.armorCurrent)
  expect(postLoad.sheet.hullPoints).toBe(preSave.sheet.hullPoints)
  expect(postLoad.desc.priorityShipKey).toBe('ship')
})
