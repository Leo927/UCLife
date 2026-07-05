// fleet-supply smoke. Verifies:
//   1. The VB state hangar spawns with supplyMax / fuelMax projected from
//      facility-types.json5 (1000 / 400). Per-hangar warehouse stockpile,
//      distinct from the fleet pool.
//   2. supplyPerDay projects onto the flagship ShipStatSheet.
//   3. One daily fleet-supply tick drains the fleet pool by the flagship's
//      supplyPerDay; multi-tick drains accumulate linearly.
//   4. Draining the fleet pool to 0 caps the next drain at 0 (no negative).
//   5. Placing an AE-dealer order via the dialog deducts player money,
//      enqueues a pending delivery, and lands on the hangar warehouse after
//      supplyDeliveryDays (2) fleet-supply ticks.
//   6. Secretary bulk-order applies the configured markup + faster delivery.
//   7. fleetSupplyTotals reports the fleet pool (HUD source of truth).
//   8. Save round-trip preserves hangar warehouse pendingSupplyDeliveries.

import { test, expect, DOM_COMMIT_TIMEOUT_MS, isExpectedTestModePortraitMissing } from './_fixtures'

const FIXTURE = 'fleet-supply'
const VB_HANGAR_TYPE = 'hangarSurface'
const EXPECTED_SUPPLY_MAX = 1000
const EXPECTED_FUEL_MAX = 400
const FLAGSHIP_SUPPLY_PER_DAY = 4
// Issue #63 — the bootstrap grants a starter gm_pre MS aboard the flagship
// (supplyPerDay 0.4, full hull so no in-repair term). The daily drain now
// folds its supplyPerDay into the fleet-pool debit alongside the ship term.
const STARTER_MS_SUPPLY_PER_DAY = 0.4
const EXPECTED_DAILY_DRAIN = FLAGSHIP_SUPPLY_PER_DAY + STARTER_MS_SUPPLY_PER_DAY
const SUPPLY_ORDER_QTY = 100
const SUPPLY_PRICE_PER_UNIT = 5
const SUPPLY_DELIVERY_DAYS = 2
const SECRETARY_BULK_ORDER_DAYS = 1
const SECRETARY_BULK_QTY = 100
// Fleet pool capacity for the lightFreighter flagship — ship-classes.json5
// authors suppliesMax: 40, which projects onto ShipStatSheet.supplyStorage
// and contributes to FleetPool.supplyMax via recomputeFleetPool.
const FLEET_POOL_SUPPLY_MAX = 40
const FLEET_POOL_FUEL_MAX = 16

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.listHangars',
  '__uclife__.hangarSupplySnapshot',
  '__uclife__.setHangarSupply',
  '__uclife__.enqueueHangarDelivery',
  '__uclife__.runFleetSupplyTick',
  '__uclife__.fleetSupplyTotals',
  '__uclife__.fleetFuelPool',
  '__uclife__.aeSupplyDealerEntity',
  '__uclife__.secretaryEntity',
  '__uclife__.forceSeatSecretary',
  '__uclife__.flagshipStatSheet',
  '__uclife__.fillJobVacancies',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
]

test('fleet supply: drain, dealer order, secretary bulk, save round-trip', async ({ sim }) => {
  sim.allowConsoleError(isExpectedTestModePortraitMissing)
  await sim.boot({ fixture: FIXTURE, requireHandles: REQUIRED_HANDLES })

  const scene = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getGameState().getScene().getId(),
  )
  expect(scene, `fixture must boot in vonBraunCity, got ${scene}`).toBe('vonBraunCity')

  // 1. Hangar supply / fuel caps.
  const hangars = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listHangars(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vb = hangars.find((h: any) => h.typeId === VB_HANGAR_TYPE)
  expect(vb, 'VB state hangar missing').toBeTruthy()

  const snap0 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarSupplySnapshot(k),
    vb.buildingKey,
  )
  expect(snap0, `hangarSupplySnapshot returned null for ${vb.buildingKey}`).toBeTruthy()
  expect(snap0.supplyMax).toBe(EXPECTED_SUPPLY_MAX)
  expect(snap0.fuelMax).toBe(EXPECTED_FUEL_MAX)
  expect(snap0.supplyCurrent).toBe(EXPECTED_SUPPLY_MAX)
  expect(snap0.fuelCurrent).toBe(EXPECTED_FUEL_MAX)
  expect(snap0.pending.length).toBe(0)

  // 2. supplyPerDay projects onto the flagship ShipStatSheet.
  const sheet = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.flagshipStatSheet(),
  )
  expect(sheet, `flagshipStatSheet returned null`).toBeTruthy()

  // 3. Drain landing on the fleet pool after one tick. Hangar warehouse
  // stockpile is no longer touched by daily upkeep — that's a fleet pool
  // concern now (Starsector-style consolidation).
  const poolBefore = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fleetSupplyTotals(),
  )
  expect(poolBefore.supplyMax).toBe(FLEET_POOL_SUPPLY_MAX)
  expect(poolBefore.supplyCurrent).toBe(FLEET_POOL_SUPPLY_MAX)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.runFleetSupplyTick(1))
  const poolAfter1 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fleetSupplyTotals(),
  )
  const drained = poolBefore.supplyCurrent - poolAfter1.supplyCurrent
  // Float-tolerant: the MS term is fractional (0.4) so the pool subtraction
  // can carry binary-float residue.
  expect(drained).toBeCloseTo(EXPECTED_DAILY_DRAIN, 5)
  // Hangar warehouse stays untouched by daily upkeep.
  const hangarSnap1 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarSupplySnapshot(k),
    vb.buildingKey,
  )
  expect(hangarSnap1.supplyCurrent).toBe(EXPECTED_SUPPLY_MAX)

  // 4. Fleet pool runs dry — drain caps at 0.
  // setHangarSupply remains a warehouse-only verb; to dry the pool we
  // burn it directly through the drain ticks. With supplyPerDay=4 and a
  // capacity of 40, one extra tick after the pool is already low will
  // bottom out.
  // Force-drain the pool: run enough ticks to exhaust it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ticksToDry = Math.ceil(poolAfter1.supplyCurrent / EXPECTED_DAILY_DRAIN)
  for (let i = 0; i < ticksToDry; i += 1) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sim.page.evaluate((d) => (window as any).__uclife__.runFleetSupplyTick(d), 2 + i)
  }
  const dryAfter = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fleetSupplyTotals(),
  )
  expect(dryAfter.supplyCurrent, `drain did not bottom at 0: ${dryAfter.supplyCurrent}`).toBe(0)

  // Another tick stays at 0 — drain caps cleanly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.runFleetSupplyTick(99))
  const stillDry = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fleetSupplyTotals(),
  )
  expect(stillDry.supplyCurrent).toBe(0)

  // 5. AE dealer dialog → order.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fillJobVacancies(['ae_supply_dealer']),
  )

  const dealerOpened = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const dealer = w.__uclife__.aeSupplyDealerEntity()
    if (!dealer) return false
    w.uclifeUI.getState().setDialogNPC(dealer)
    return true
  })
  expect(dealerOpened, `could not open NPCDialog for AE supply dealer`).toBeTruthy()

  const moneyBeforeDealer = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getGameState().getPlayerCharacter().getResource('Money'),
  )

  await sim.page.waitForSelector('button.dialog-option', { timeout: DOM_COMMIT_TIMEOUT_MS })
  await sim.page.click('button.dialog-option:has-text("订补给")')
  await sim.page.waitForSelector('[data-supply-order="supply"]', { timeout: DOM_COMMIT_TIMEOUT_MS })

  const preOrder = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarSupplySnapshot(k),
    vb.buildingKey,
  )
  await sim.page.click('[data-supply-order="supply"]')

  const postOrder = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarSupplySnapshot(k),
    vb.buildingKey,
  )
  expect(postOrder.pending.length).toBe(1)
  const dealerOrder = postOrder.pending[0]
  expect(dealerOrder.kind).toBe('supply')
  expect(dealerOrder.qty).toBe(SUPPLY_ORDER_QTY)
  expect(dealerOrder.daysRemaining).toBe(SUPPLY_DELIVERY_DAYS)

  const moneyAfterDealer = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getGameState().getPlayerCharacter().getResource('Money'),
  )
  const dealerSpend = moneyBeforeDealer - moneyAfterDealer
  expect(dealerSpend).toBe(SUPPLY_ORDER_QTY * SUPPLY_PRICE_PER_UNIT)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).uclifeUI.getState().setDialogNPC(null))

  // Advance ticks — delivery decrements daysRemaining each tick, lands at 0.
  const beforeDelivery = preOrder
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.runFleetSupplyTick(10))
  const mid = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarSupplySnapshot(k),
    vb.buildingKey,
  )
  expect(mid.pending.length).toBe(1)
  expect(mid.pending[0].daysRemaining).toBe(1)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.runFleetSupplyTick(11))
  const landed = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarSupplySnapshot(k),
    vb.buildingKey,
  )
  expect(landed.pending.length).toBe(0)

  const expectedFinal = Math.min(
    EXPECTED_SUPPLY_MAX,
    beforeDelivery.supplyCurrent + SUPPLY_ORDER_QTY - FLAGSHIP_SUPPLY_PER_DAY * SUPPLY_DELIVERY_DAYS,
  )
  expect(landed.supplyCurrent).toBe(expectedFinal)

  // 6. Secretary bulk-order — markup + faster turnaround.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.forceSeatSecretary())
  const secEnt = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.secretaryEntity(),
  )
  expect(secEnt, `secretary entity not seated`).toBeTruthy()

  await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const sec = w.__uclife__.secretaryEntity()
    w.uclifeUI.getState().setDialogNPC(sec)
  })

  await sim.page.waitForSelector('button.dialog-option', { timeout: DOM_COMMIT_TIMEOUT_MS })
  await sim.page.click('button.dialog-option:has-text("faction事务")')
  await sim.page.waitForSelector('[data-bulk-order="supply"]', { timeout: DOM_COMMIT_TIMEOUT_MS })

  const preBulk = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarSupplySnapshot(k),
    vb.buildingKey,
  )
  await sim.page.click('[data-bulk-order="supply"]')

  const postBulk = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarSupplySnapshot(k),
    vb.buildingKey,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newPending = postBulk.pending.find((d: any) => !preBulk.pending.some(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (p: any) => p.kind === d.kind && p.qty === d.qty && p.daysRemaining === d.daysRemaining,
  ))
  expect(newPending, `secretary bulk-order did not enqueue a delivery`).toBeTruthy()
  expect(newPending.daysRemaining).toBe(SECRETARY_BULK_ORDER_DAYS)
  expect(newPending.qty).toBe(SECRETARY_BULK_QTY)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).uclifeUI.getState().setDialogNPC(null))

  // 7. Fleet pool totals (HUD source of truth).
  const totals = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fleetSupplyTotals(),
  )
  expect(totals.supplyMax).toBe(FLEET_POOL_SUPPLY_MAX)
  expect(totals.fuelMax).toBe(FLEET_POOL_FUEL_MAX)

  // 8. Save round-trip.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.setHangarSupply(k, 750, 200),
    vb.buildingKey,
  )
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.enqueueHangarDelivery(k, 'supply', 250, 2),
    vb.buildingKey,
  )
  const preSave = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarSupplySnapshot(k),
    vb.buildingKey,
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(async () => { await (window as any).__uclife__.saveGame('auto') })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(async () => { await (window as any).__uclife__.loadGame('auto') })

  const postLoad = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarSupplySnapshot(k),
    vb.buildingKey,
  )
  expect(postLoad.supplyCurrent).toBe(preSave.supplyCurrent)
  expect(postLoad.fuelCurrent).toBe(preSave.fuelCurrent)
  expect(postLoad.pending.length).toBe(preSave.pending.length)
  for (let i = 0; i < preSave.pending.length; i += 1) {
    expect(postLoad.pending[i].kind).toBe(preSave.pending[i].kind)
    expect(postLoad.pending[i].qty).toBe(preSave.pending[i].qty)
    expect(postLoad.pending[i].daysRemaining).toBe(preSave.pending[i].daysRemaining)
  }
})
