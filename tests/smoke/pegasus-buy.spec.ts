// Pegasus buy + fleet roster smoke.
//  1. Drydock AE sales rep seated at world-init.
//  2. shipSalesRepEntity locates that rep.
//  3. enqueueShipDelivery accepts pegasusClass + drydock building.
//  4. enqueueShipDelivery rejects unknown buildingKey.
//  5. runShipDeliveryTick(arrivalDay) flips the row to 'arrived'.
//  6. receiveShipDelivery spawns a pegasusClass Ship at vonBraunDrydock.
//  7. fleetRosterSnapshot lists exactly TWO ships.
//  8. setFleetRosterOpen toggles.
//  9. Save round-trip preserves state.
// 10. No-slot path fires once capital slots are filled.

import { test, expect } from './_fixtures'

const PEGASUS_LEAD_DAYS = 5
const ORDER_DAY_INITIAL = 1
const ARRIVAL_DAY_INITIAL = ORDER_DAY_INITIAL + PEGASUS_LEAD_DAYS
const ORDER_DAY_SAVE_RT = 20
const NO_SLOT_FILL_ORDER_DAY = 1100
const NO_SLOT_FILL_TICK_DAY = 1200
const NO_SLOT_PROBE_ORDER_DAY = 2000
const NO_SLOT_PROBE_TICK_DAY = 2100
const HIGH_FLUSH_TICK_DAY = 1000
const EXPECTED_FLEET_AFTER_BUY = 2

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.listHangarsAllScenes',
  '__uclife__.fillJobVacancies',
  '__uclife__.deliverySnapshot',
  '__uclife__.enqueueShipDelivery',
  '__uclife__.runShipDeliveryTick',
  '__uclife__.receiveShipDelivery',
  '__uclife__.hangarOccupancy',
  '__uclife__.listShipsInFleet',
  '__uclife__.shipSalesRepEntity',
  '__uclife__.fleetRosterSnapshot',
  '__uclife__.setFleetRosterOpen',
  '__uclife__.forceShipDocking',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
]

test('pegasus buy: enqueue, arrive, receive, roster, save round-trip, capacity', async ({ sim }) => {
  await sim.boot({ fixture: 'starter-fleet', requireHandles: REQUIRED_HANDLES })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.fillJobVacancies(['hangar_manager']))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.fillJobVacancies(['hangar_manager']))

  const drydockRep = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.shipSalesRepEntity('ae_ship_sales_vbd'),
  )
  expect(drydockRep, 'ae_ship_sales_vbd rep missing').toBeTruthy()

  const hangars = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listHangarsAllScenes(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drydock = hangars.find((h: any) => h.typeId === 'hangarDrydock')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vbHangar = hangars.find((h: any) => h.typeId === 'hangarSurface')
  expect(drydock, 'Von Braun drydock building missing').toBeTruthy()
  expect(vbHangar, 'VB state hangar building missing').toBeTruthy()

  const bad = await sim.page.evaluate(
    ([orderDay, lead]) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.enqueueShipDelivery(
        'bld-nonexistent-x-0', 'pegasusClass', orderDay, lead,
      ),
    [ORDER_DAY_INITIAL, PEGASUS_LEAD_DAYS],
  )
  expect(bad, `enqueueShipDelivery accepted bogus buildingKey`).toBeNull()

  const enq = await sim.page.evaluate(
    (arg) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.enqueueShipDelivery(arg.k, 'pegasusClass', arg.orderDay, arg.lead),
    { k: drydock.buildingKey, orderDay: ORDER_DAY_INITIAL, lead: PEGASUS_LEAD_DAYS },
  )
  expect(enq && enq.rowIndex === 0, `enqueue rowIndex unexpected`).toBeTruthy()

  const snap1 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.deliverySnapshot(),
  )
  const row1 = snap1.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (r: any) => r.shipClassId === 'pegasusClass' && r.hangarKey === drydock.buildingKey,
  )
  expect(row1, `no pegasus row in snapshot for drydock`).toBeTruthy()
  expect(row1.status).toBe('in_transit')
  expect(row1.arrivalDay).toBe(ARRIVAL_DAY_INITIAL)

  const earlyRx = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.receiveShipDelivery(k, 0),
    drydock.buildingKey,
  )
  expect(earlyRx.ok === false && earlyRx.reason === 'not_arrived').toBeTruthy()

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
  const row2 = snap2.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (r: any) => r.shipClassId === 'pegasusClass' && r.hangarKey === drydock.buildingKey,
  )
  expect(row2?.status).toBe('arrived')

  const occBefore = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarOccupancy(k),
    drydock.buildingKey,
  )
  const fleetBefore = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listShipsInFleet(),
  )
  const rx = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.receiveShipDelivery(k, 0),
    drydock.buildingKey,
  )
  expect(rx.ok, `receive returned not-ok: ${JSON.stringify(rx)}`).toBeTruthy()

  const occAfter = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarOccupancy(k),
    drydock.buildingKey,
  )
  const fleetAfter = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listShipsInFleet(),
  )
  const capBefore = occBefore.occupied.capital ?? 0
  const capAfter = occAfter.occupied.capital ?? 0
  expect(capAfter).toBe(capBefore + 1)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newShip = fleetAfter.find((s: any) => !fleetBefore.some((b: any) => b.entityKey === s.entityKey))
  expect(newShip, 'could not isolate newly-spawned Pegasus').toBeTruthy()
  expect(newShip.templateId).toBe('pegasusClass')
  expect(newShip.dockedAtPoiId).toBe('vonBraunDrydock')
  expect(newShip.isFlagship, 'new pegasus spawned with IsFlagshipMark').toBeFalsy()
  expect(newShip.hullCurrent).toBe(newShip.hullMax)

  const snap3 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.deliverySnapshot(),
  )
  expect(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    !snap3.find((r: any) => r.shipClassId === 'pegasusClass' && r.hangarKey === drydock.buildingKey),
    'pegasus row not popped from queue after receive',
  ).toBeTruthy()

  const roster = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fleetRosterSnapshot(),
  )
  expect(roster.length).toBe(EXPECTED_FLEET_AFTER_BUY)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flagshipRow = roster.find((r: any) => r.isFlagship)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pegasusRow = roster.find((r: any) => r.templateId === 'pegasusClass')
  expect(flagshipRow, 'roster missing flagship entry').toBeTruthy()
  expect(flagshipRow.templateId).toBe('lightFreighter')
  expect(flagshipRow.poiId).toBe('vonBraun')
  expect(flagshipRow.shipName, 'flagship row missing shipName').toBeTruthy()
  expect(pegasusRow, 'roster missing pegasus entry').toBeTruthy()
  expect(pegasusRow.poiId).toBe('vonBraunDrydock')
  expect(pegasusRow.hangarSlotClass).toBe('capital')
  expect(pegasusRow.isFlagship, 'pegasus marked flagship in roster').toBeFalsy()

  const opened = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.setFleetRosterOpen(true),
  )
  expect(opened).toBe(true)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.setFleetRosterOpen(false))

  await sim.page.evaluate(
    (arg) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.enqueueShipDelivery(arg.k, 'pegasusClass', arg.orderDay, arg.lead),
    { k: drydock.buildingKey, orderDay: ORDER_DAY_SAVE_RT, lead: PEGASUS_LEAD_DAYS },
  )
  const preSaveSnap = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.deliverySnapshot(),
  )
  const preSaveFleet = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listShipsInFleet(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(async () => { await (window as any).__uclife__.saveGame('auto') })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(async () => { await (window as any).__uclife__.loadGame('auto') })
  await sim.waitForBoot(['__uclife__.deliverySnapshot'])

  const postLoadSnap = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.deliverySnapshot(),
  )
  const postLoadFleet = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listShipsInFleet(),
  )
  expect(postLoadSnap.length).toBe(preSaveSnap.length)
  expect(postLoadFleet.length).toBe(preSaveFleet.length)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const postPegasus = postLoadFleet.find((s: any) => s.templateId === 'pegasusClass')
  expect(postPegasus, 'save round-trip lost the spawned Pegasus').toBeTruthy()
  expect(postPegasus.dockedAtPoiId).toBe('vonBraunDrydock')

  const capCap = drydock.slotCapacity.capital ?? 0
  let curCap = ((await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.hangarOccupancy(k),
    drydock.buildingKey,
  )).occupied.capital ?? 0) as number

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d) => (window as any).__uclife__.runShipDeliveryTick(d),
    HIGH_FLUSH_TICK_DAY,
  )
  while (curCap < capCap) {
    const snap = await sim.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__uclife__.deliverySnapshot(),
    )
    const idx = snap.findIndex(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (r: any) => r.hangarKey === drydock.buildingKey
        && r.shipClassId === 'pegasusClass' && r.status === 'arrived',
    )
    if (idx < 0) {
      await sim.page.evaluate(
        (arg) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__uclife__.enqueueShipDelivery(arg.k, 'pegasusClass', arg.orderDay, 0),
        { k: drydock.buildingKey, orderDay: NO_SLOT_FILL_ORDER_DAY },
      )
      await sim.page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (d) => (window as any).__uclife__.runShipDeliveryTick(d),
        NO_SLOT_FILL_TICK_DAY,
      )
      continue
    }
    const r = await sim.page.evaluate(
      (arg) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__uclife__.receiveShipDelivery(arg.k, arg.idx),
      { k: drydock.buildingKey, idx },
    )
    if (!r.ok) break
    curCap += 1
  }
  expect(curCap, `could not fill all ${capCap} capital slots — only filled to ${curCap}`).toBe(capCap)

  await sim.page.evaluate(
    (arg) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.enqueueShipDelivery(arg.k, 'pegasusClass', arg.orderDay, 0),
    { k: drydock.buildingKey, orderDay: NO_SLOT_PROBE_ORDER_DAY },
  )
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d) => (window as any).__uclife__.runShipDeliveryTick(d),
    NO_SLOT_PROBE_TICK_DAY,
  )
  const blockSnap = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.deliverySnapshot(),
  )
  const blockIdx = blockSnap.findIndex(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (r: any) => r.hangarKey === drydock.buildingKey
      && r.shipClassId === 'pegasusClass' && r.status === 'arrived',
  )
  expect(blockIdx >= 0, `expected at least one arrived row to test no_slot gate`).toBeTruthy()
  const blocked = await sim.page.evaluate(
    (arg) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.receiveShipDelivery(arg.k, arg.idx),
    { k: drydock.buildingKey, idx: blockIdx },
  )
  expect(blocked.ok === false && blocked.reason === 'no_slot').toBeTruthy()
})
