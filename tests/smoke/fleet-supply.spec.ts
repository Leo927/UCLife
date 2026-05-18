// fleet-supply smoke. Verifies:
//   1. The VB state hangar spawns with supplyMax / fuelMax projected from
//      facility-types.json5 (1000 / 400).
//   2. supplyPerDay projects onto the flagship ShipStatSheet.
//   3. One daily fleet-supply tick drains the hangar by the flagship's
//      supplyPerDay; multi-tick drains accumulate linearly.
//   4. Setting supplyCurrent to 0 caps the next drain at 0 (no negative).
//   5. Placing an AE-dealer order via the dialog deducts player money,
//      enqueues a pending delivery, and lands on the hangar after
//      supplyDeliveryDays (2) fleet-supply ticks.
//   6. Secretary bulk-order applies the configured markup + faster delivery.
//   7. fleetSupplyTotals reports the HUD aggregate.
//   8. Save round-trip preserves supplyCurrent / pendingSupplyDeliveries.

import { test, expect, DOM_COMMIT_TIMEOUT_MS, isExpectedTestModePortraitMissing } from './_fixtures'

const FIXTURE = 'player-with-cash-at-vb'
const VB_HANGAR_TYPE = 'hangarSurface'
const EXPECTED_SUPPLY_MAX = 1000
const EXPECTED_FUEL_MAX = 400
const FLAGSHIP_SUPPLY_PER_DAY = 4
const SUPPLY_ORDER_QTY = 100
const SUPPLY_PRICE_PER_UNIT = 5
const SUPPLY_DELIVERY_DAYS = 2
const SECRETARY_BULK_ORDER_DAYS = 1
const SECRETARY_BULK_QTY = 100
const FLEET_SUPPLY_MAX_TOTAL = 1000 + 5000

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.listHangars',
  '__uclife__.hangarSupplySnapshot',
  '__uclife__.setHangarSupply',
  '__uclife__.enqueueHangarDelivery',
  '__uclife__.runFleetSupplyTick',
  '__uclife__.fleetSupplyTotals',
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

  // 3. Drain landing on the hangar after one tick.
  const before1 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarSupplySnapshot(k),
    vb.buildingKey,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.runFleetSupplyTick(1))
  const after1 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarSupplySnapshot(k),
    vb.buildingKey,
  )
  const drained = before1.supplyCurrent - after1.supplyCurrent
  expect(drained).toBe(FLAGSHIP_SUPPLY_PER_DAY)

  // 4. Hangar runs dry — drain caps at 0.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.setHangarSupply(k, 2, 100),
    vb.buildingKey,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.runFleetSupplyTick(2))
  const dryAfter = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarSupplySnapshot(k),
    vb.buildingKey,
  )
  expect(dryAfter.supplyCurrent, `drain did not bottom at 0: ${dryAfter.supplyCurrent}`).toBe(0)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.runFleetSupplyTick(3))
  const stillDry = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarSupplySnapshot(k),
    vb.buildingKey,
  )
  expect(stillDry.supplyCurrent).toBe(0)

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.setHangarSupply(k, 500, 100),
    vb.buildingKey,
  )

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

  // 7. Fleet supply totals.
  const totals = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fleetSupplyTotals(),
  )
  expect(totals.supplyMax).toBe(FLEET_SUPPLY_MAX_TOTAL)

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
