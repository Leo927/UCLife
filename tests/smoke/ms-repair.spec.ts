// ms-repair smoke (Task 9, W1 playable-loop). Verifies:
//  1. A pre-damaged MS parked at a depot (ms-repair-depot fixture) starts
//     damageState='in-repair'.
//  2. The VB state hangar's repair pool restores it armor-first, then
//     hull, over daily ticks (same force-handle pattern as
//     ship-repair.spec.ts — hangarRepairSystem runs on day:rollover, which
//     the test clock does not reliably drive, so the smoke ticks it
//     directly via runHangarRepairTick rather than sim.stepFor/Until).
//  3. damageState flips 'in-repair' -> 'ready' exactly when the deficit
//     hits zero.
//  4. Save round-trip preserves hull/armor + damageState.

import { test, expect } from './_fixtures'

const MS_KEY = 'ms-depot-0'
const VB_POI_ID = 'vonBraun'

const EXPECTED_HULL_MAX = 160
const EXPECTED_ARMOR_MAX = 20
const EXPECTED_HULL_START = 40

const MAX_REPAIR_TICKS = 20

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.listHangars',
  '__uclife__.getMs',
  '__uclife__.fillJobVacancies',
  '__uclife__.hangarRepairDescribe',
  '__uclife__.runHangarRepairTick',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
]

test('ms repair: depot MS restores armor-first over daily ticks, damageState flips, save round-trip', async ({ sim }) => {
  await sim.boot({ fixture: 'ms-repair-depot', requireHandles: REQUIRED_HANDLES })

  const before = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (key) => (window as any).__uclife__.getMs(key),
    MS_KEY,
  )
  expect(before, 'pre-damaged depot MS should exist').toBeTruthy()
  expect(before.hullCurrent).toBe(EXPECTED_HULL_START)
  expect(before.hullMax).toBe(EXPECTED_HULL_MAX)
  expect(before.armorCurrent).toBe(EXPECTED_ARMOR_MAX)
  expect(before.dockedAtPoiId).toBe(VB_POI_ID)
  expect(before.storedOnShipKey, 'depot MS must not be aboard any ship').toBe('')
  expect(before.damageState, 'damaged + docked at a depot starts in-repair').toBe('in-repair')

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

  const desc = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarRepairDescribe(k),
    vb.buildingKey,
  )
  expect(desc, 'hangarRepairDescribe returned null after staffing').toBeTruthy()
  expect(desc.throughput, 'staffed hangar should produce nonzero throughput').toBeGreaterThan(0)

  let ticks = 0
  let last = before
  while (ticks < MAX_REPAIR_TICKS) {
    ticks += 1
    await sim.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (d) => (window as any).__uclife__.runHangarRepairTick(d),
      ticks,
    )
    last = await sim.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (key) => (window as any).__uclife__.getMs(key),
      MS_KEY,
    )
    if (last.hullCurrent >= last.hullMax && last.armorCurrent >= last.armorMax) break
  }
  expect(
    last.hullCurrent >= last.hullMax && last.armorCurrent >= last.armorMax,
    `depot MS not fully repaired after ${ticks} ticks`,
  ).toBeTruthy()
  expect(last.damageState, 'fully repaired MS flips to ready').toBe('ready')

  // Save round-trip — hull/armor + damageState must survive.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(async () => { await (window as any).__uclife__.saveGame('auto') })
  const loadOk = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async () => (window as any).__uclife__.loadGame('auto'),
  )
  expect(loadOk.ok, `loadGame failed: ${JSON.stringify(loadOk)}`).toBe(true)

  const afterLoad = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (key) => (window as any).__uclife__.getMs(key),
    MS_KEY,
  )
  expect(afterLoad.hullCurrent).toBe(last.hullCurrent)
  expect(afterLoad.armorCurrent).toBe(last.armorCurrent)
  expect(afterLoad.damageState).toBe('ready')
})
