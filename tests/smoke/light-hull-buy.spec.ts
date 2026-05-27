// light-hull buy smoke. Coverage:
//   1. AE Von Braun ship-sales rep seated at the airport sales desk.
//   2. enqueueShipDelivery refuses gracefully when buildingKey unknown.
//   3. enqueueShipDelivery records a pending row.
//   4. runShipDeliveryTick(arrivalDay) flips status to 'arrived'.
//   5. receiveShipDelivery spawns a new Ship entity in the fleet.
//   6. receiveShipDelivery returns reason='not_arrived' / 'no_row' correctly.
//   7. Save round-trip preserves a pending delivery row exactly.
//   8. The no-slot path fires when capacity is filled.

import { test, expect } from './_fixtures'

const SMALL_HULL_LEAD_DAYS = 2
const ORDER_DAY_INITIAL = 1
const ARRIVAL_DAY_INITIAL = ORDER_DAY_INITIAL + SMALL_HULL_LEAD_DAYS
const ORDER_DAY_SAVE_RT = 5
const NO_SLOT_TICK_DAY = 100
const NO_SLOT_ENQUEUE_DAY = 50
const NO_SLOT_FINAL_DAY = 101
const SLOT_KEY = 'smallCraft'
const ORDER_DAY_FOR_NO_SLOT_PROBE = 100

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.listHangars',
  '__uclife__.fillJobVacancies',
  '__uclife__.deliverySnapshot',
  '__uclife__.enqueueShipDelivery',
  '__uclife__.runShipDeliveryTick',
  '__uclife__.receiveShipDelivery',
  '__uclife__.hangarOccupancy',
  '__uclife__.listShipsInFleet',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
]

test('light-hull buy: enqueue, arrive, receive, capacity, save round-trip', async ({ sim }) => {
  await sim.boot({ requireHandles: REQUIRED_HANDLES })

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fillJobVacancies(
      ['ae_ship_sales_vb', 'hangar_manager', 'hangar_worker'],
    ),
  )

  const salesSeated = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fillJobVacancies(['ae_ship_sales_vb']),
  )
  expect(Array.isArray(salesSeated), `fillJobVacancies returned non-array`).toBeTruthy()
  expect(salesSeated[0]?.ok, `ae_ship_sales_vb fill failed: ${JSON.stringify(salesSeated)}`).toBeTruthy()

  const hangars = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listHangars(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vb = hangars.find((h: any) => h.typeId === 'hangarSurface')
  expect(vb, 'VB state hangar missing').toBeTruthy()

  const bad = await sim.page.evaluate(
    ([orderDay, lead]) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.enqueueShipDelivery(
        'bld-nonexistent-x-0', 'lunarMilitia', orderDay, lead,
      ),
    [ORDER_DAY_INITIAL, SMALL_HULL_LEAD_DAYS],
  )
  expect(bad, `enqueueShipDelivery accepted bogus buildingKey`).toBeNull()

  const enq = await sim.page.evaluate(
    (arg) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.enqueueShipDelivery(arg.k, 'lunarMilitia', arg.orderDay, arg.lead),
    { k: vb.buildingKey, orderDay: ORDER_DAY_INITIAL, lead: SMALL_HULL_LEAD_DAYS },
  )
  expect(enq && enq.rowIndex === 0, `enqueue rowIndex unexpected`).toBeTruthy()

  const snap1 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.deliverySnapshot(),
  )
  expect(snap1.length).toBe(1)
  const row = snap1[0]
  expect(row.status).toBe('in_transit')
  expect(row.shipClassId).toBe('lunarMilitia')
  expect(row.orderDay).toBe(ORDER_DAY_INITIAL)
  expect(row.arrivalDay).toBe(ARRIVAL_DAY_INITIAL)

  const earlyRx = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.receiveShipDelivery(k, 0),
    vb.buildingKey,
  )
  expect(
    earlyRx.ok === false && earlyRx.reason === 'not_arrived',
    `receive before arrival should refuse with not_arrived; got ${JSON.stringify(earlyRx)}`,
  ).toBeTruthy()

  const tickRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d) => (window as any).__uclife__.runShipDeliveryTick(d),
    ARRIVAL_DAY_INITIAL,
  )
  expect(tickRes && tickRes.rowsArrived === 1, `runShipDeliveryTick unexpected`).toBeTruthy()

  const snap2 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.deliverySnapshot(),
  )
  expect(snap2[0]?.status).toBe('arrived')

  const occupancyBefore = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarOccupancy(k),
    vb.buildingKey,
  )
  const fleetBefore = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listShipsInFleet(),
  )
  const rx = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.receiveShipDelivery(k, 0),
    vb.buildingKey,
  )
  expect(rx.ok, `receive returned not-ok: ${JSON.stringify(rx)}`).toBeTruthy()

  const occupancyAfter = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarOccupancy(k),
    vb.buildingKey,
  )
  const fleetAfter = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listShipsInFleet(),
  )

  const occBefore = occupancyBefore.occupied[SLOT_KEY] ?? 0
  const occAfter = occupancyAfter.occupied[SLOT_KEY] ?? 0
  expect(occAfter).toBe(occBefore + 1)
  expect(fleetAfter.length).toBe(fleetBefore.length + 1)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newShip = fleetAfter.find((s: any) => !fleetBefore.some((b: any) => b.entityKey === s.entityKey))
  expect(newShip, 'could not isolate newly-spawned ship').toBeTruthy()
  expect(newShip.templateId).toBe('lunarMilitia')
  expect(newShip.dockedAtPoiId).toBe('vonBraun')
  expect(newShip.isFlagship, 'new ship spawned with IsFlagshipMark').toBeFalsy()
  expect(newShip.hullCurrent).toBe(newShip.hullMax)

  const snap3 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.deliverySnapshot(),
  )
  expect(snap3.length).toBe(0)

  const oob = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.receiveShipDelivery(k, 99),
    vb.buildingKey,
  )
  expect(oob.ok === false && oob.reason === 'no_row', `OOB receive should be no_row`).toBeTruthy()

  await sim.page.evaluate(
    (arg) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.enqueueShipDelivery(arg.k, 'lunarMilitia', arg.orderDay, arg.lead),
    { k: vb.buildingKey, orderDay: ORDER_DAY_SAVE_RT, lead: SMALL_HULL_LEAD_DAYS },
  )
  const preSave = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.deliverySnapshot(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(async () => { await (window as any).__uclife__.saveGame('auto') })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(async () => { await (window as any).__uclife__.loadGame('auto') })
  await sim.waitForBoot(['__uclife__.deliverySnapshot'])

  const postLoad = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.deliverySnapshot(),
  )
  expect(postLoad.length).toBe(preSave.length)
  expect(postLoad[0]?.shipClassId).toBe(preSave[0]?.shipClassId)
  expect(postLoad[0]?.orderDay).toBe(preSave[0]?.orderDay)
  expect(postLoad[0]?.arrivalDay).toBe(preSave[0]?.arrivalDay)
  expect(postLoad[0]?.status).toBe(preSave[0]?.status)

  // Total capacity that can host a smallCraft hull, given the slot
  // hierarchy (capital ⊇ ms ⊇ smallCraft). VB surface hangar has both
  // smallCraft and ms inventories — fill both before the no_slot probe.
  const cap = (vb.slotCapacity.smallCraft ?? 0)
    + (vb.slotCapacity.ms ?? 0)
    + (vb.slotCapacity.capital ?? 0)
  const occupancyAfterReceive = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarOccupancy(k),
    vb.buildingKey,
  )
  const occupiedAfterReceive = (occupancyAfterReceive.occupied.smallCraft ?? 0)
    + (occupancyAfterReceive.occupied.ms ?? 0)
    + (occupancyAfterReceive.occupied.capital ?? 0)
  const needToFillSlots = cap - occupiedAfterReceive
  for (let i = 0; i < needToFillSlots; i++) {
    await sim.page.evaluate(
      (arg) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__uclife__.enqueueShipDelivery(arg.k, 'lunarMilitia', arg.orderDay, 0),
      { k: vb.buildingKey, orderDay: NO_SLOT_ENQUEUE_DAY },
    )
  }
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d) => (window as any).__uclife__.runShipDeliveryTick(d),
    NO_SLOT_TICK_DAY,
  )
  let receiveOK = 0
  let safety = 0
  const safetyLimit = cap + 4
  while (receiveOK < needToFillSlots && safety < safetyLimit) {
    safety += 1
    const r = await sim.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (k) => (window as any).__uclife__.receiveShipDelivery(k, 0),
      vb.buildingKey,
    )
    if (r.ok) receiveOK += 1
    else if (r.reason !== 'no_row') break
  }
  expect(receiveOK).toBe(needToFillSlots)

  await sim.page.evaluate(
    (arg) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.enqueueShipDelivery(arg.k, 'lunarMilitia', arg.orderDay, 0),
    { k: vb.buildingKey, orderDay: ORDER_DAY_FOR_NO_SLOT_PROBE },
  )
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d) => (window as any).__uclife__.runShipDeliveryTick(d),
    NO_SLOT_FINAL_DAY,
  )
  const slotBlocked = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.receiveShipDelivery(k, 0),
    vb.buildingKey,
  )
  // Phase 6.2.5 — receive-delivery cascades to carrier internal bays when
  // the POI hangar slots are full. The lightFreighter flagship docked at
  // VB advertises `hangarCapacity` > 0, so the 9th smallCraft receive
  // lands on the flagship instead of failing. The test still verifies
  // that the *combined* capacity is exhausted: walk the carrier bays
  // until everything is full, then assert the final probe fails. The
  // test's safety bound is `cap + 4` so a runaway loop is bounded.
  if (slotBlocked.ok) {
    // Drained one bay; check if any spare bay remains before declaring
    // capacity exhausted. We probe iteratively until receive fails.
    let probeSafety = 0
    let probe = slotBlocked
    while (probe.ok && probeSafety < 16) {
      probeSafety += 1
      // Enqueue + tick + receive another.
      await sim.page.evaluate(
        (arg) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__uclife__.enqueueShipDelivery(arg.k, 'lunarMilitia', arg.orderDay, 0),
        { k: vb.buildingKey, orderDay: ORDER_DAY_FOR_NO_SLOT_PROBE },
      )
      await sim.page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (d) => (window as any).__uclife__.runShipDeliveryTick(d),
        NO_SLOT_FINAL_DAY,
      )
      probe = await sim.page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (k) => (window as any).__uclife__.receiveShipDelivery(k, 0),
        vb.buildingKey,
      )
    }
    expect(
      probe.ok === false && probe.reason === 'no_slot',
      `expected no_slot after cascade exhausted, got: ${JSON.stringify(probe)}`,
    ).toBeTruthy()
  } else {
    expect(
      slotBlocked.reason === 'no_slot',
      `expected no_slot at capacity, got: ${JSON.stringify(slotBlocked)}`,
    ).toBeTruthy()
  }
})
