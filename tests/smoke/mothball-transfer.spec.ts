// mothball + hangar transfer smoke. Coverage:
//   1. Mothball a non-flagship ship → IsInActiveFleet cleared,
//      Ship.mothballed=true, drain/salary skip the ship.
//   2. Try to mothball the flagship → refused with flagship_locked.
//   3. Un-mothball → drain resumes, salary resumes.
//   4. Transfer ship VB → drydock via the hangar transfer surface.
//   5. Transfer to a full hangar → refused with dest_no_slot.
//   6. Transfer a mothballed ship → refused with mothballed.
//   7. Transfer a ship in transit → refused with in_transit.
//   8. Save round-trip: mothball state survives.

import { test, expect } from './_fixtures'

const CHEAT_MONEY = 5_000_000
const ORDER_DAY_SHIP_A = 1
const SMALL_HULL_LEAD_DAYS = 2
const ARRIVAL_DAY_SHIP_A = ORDER_DAY_SHIP_A + SMALL_HULL_LEAD_DAYS
const SALARY_TICK_DAY_PRE = 1
const SALARY_TICK_DAY_POST = 2
const SALARY_TICK_DAY_RESUMED = 3
const TRANSFER_ORDER_DAY = 5
const MOTH_TRANSFER_ORDER_DAY = 10
const FULL_TRANSFER_ORDER_DAY = 11
// VB surface hangar has 4 smallCraft + 4 ms slots. With the slot hierarchy
// (capital ⊇ ms ⊇ smallCraft) a smallCraft ship can occupy either class —
// the snug fit is preferred but ms slots accept smallCraft wastefully when
// the smallCraft inventory is full. To genuinely block a smallCraft
// transfer the test fills both bays = 8 total ships.
const VB_FILL_CAP = 8
const SHIP_B_ORDER_DAY = 11
const SHIP_B_ARRIVAL_DAY = SHIP_B_ORDER_DAY + SMALL_HULL_LEAD_DAYS

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.fillJobVacancies',
  '__uclife__.listShipsInFleet',
  '__uclife__.listHangarsAllScenes',
  '__uclife__.enqueueShipDelivery',
  '__uclife__.runShipDeliveryTick',
  '__uclife__.receiveShipDelivery',
  '__uclife__.setIsInActiveFleet',
  '__uclife__.setShipMothballedViaDebug',
  '__uclife__.isShipMothballed',
  '__uclife__.listTransferDestinationsViaDebug',
  '__uclife__.enqueueHangarTransferViaDebug',
  '__uclife__.runFleetSupplyDrainTick',
  '__uclife__.runFactionSalaryTick',
  '__uclife__.runFleetTransitTick',
  '__uclife__.fleetTransitDescribe',
  '__uclife__.warRoomDescribe',
  '__uclife__.spawnTestNpc',
  '__uclife__.hireCaptainViaDebug',
  '__uclife__.hireCrewViaDebug',
  '__uclife__.cheatMoney',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
  '__uclife__.forceFillHangarSlots',
]

test('mothball + hangar transfer + save round-trip', async ({ sim }) => {
  await sim.boot({ fixture: 'starter-fleet', requireHandles: REQUIRED_HANDLES })

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (n) => (window as any).__uclife__.cheatMoney(n),
    CHEAT_MONEY,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.fillJobVacancies(['hangar_manager']))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.fillJobVacancies(['hangar_manager']))

  const initialFleet = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listShipsInFleet(),
  )
  expect(initialFleet.length).toBe(1)
  const flagshipKey = initialFleet[0].entityKey

  const hangars = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listHangarsAllScenes(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vbHangar = hangars.find((h: any) => h.typeId === 'hangarSurface')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drydock = hangars.find((h: any) => h.typeId === 'hangarDrydock')
  expect(vbHangar, 'VB hangar missing').toBeTruthy()
  expect(drydock, 'Von Braun drydock missing').toBeTruthy()

  await sim.page.evaluate(
    (arg) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.enqueueShipDelivery(arg.k, 'lunarMilitia', arg.orderDay, arg.lead),
    { k: vbHangar.buildingKey, orderDay: ORDER_DAY_SHIP_A, lead: SMALL_HULL_LEAD_DAYS },
  )
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d) => (window as any).__uclife__.runShipDeliveryTick(d),
    ARRIVAL_DAY_SHIP_A,
  )
  const rxA = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.receiveShipDelivery(k, 0),
    vbHangar.buildingKey,
  )
  expect(rxA.ok, `Ship A receive failed: ${JSON.stringify(rxA)}`).toBeTruthy()
  const shipAKey = rxA.entityKey

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.spawnTestNpc({ key: 'npc-captain', name: 'Captain Test' }),
  )
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.spawnTestNpc({ key: 'npc-crew', name: 'Crew Test' }),
  )
  const hireCap = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([n, s]) => (window as any).__uclife__.hireCaptainViaDebug(n, s),
    ['npc-captain', shipAKey],
  )
  expect(hireCap.ok, `hire captain failed: ${JSON.stringify(hireCap)}`).toBeTruthy()
  const hireCrew = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([n, s]) => (window as any).__uclife__.hireCrewViaDebug(n, s),
    ['npc-crew', shipAKey],
  )
  expect(hireCrew.ok, `hire crew failed: ${JSON.stringify(hireCrew)}`).toBeTruthy()

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.setIsInActiveFleet(k, true),
    shipAKey,
  )
  const wrPre = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.warRoomDescribe(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aRowPre = wrPre.ships.find((r: any) => r.entityKey === shipAKey)
  expect(aRowPre?.isInActiveFleet, `Ship A not promoted to active fleet`).toBeTruthy()

  const salaryPre = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d) => (window as any).__uclife__.runFactionSalaryTick(d),
    SALARY_TICK_DAY_PRE,
  )
  expect(salaryPre.captainsPaid).toBeGreaterThanOrEqual(1)
  expect(salaryPre.crewPaid).toBeGreaterThanOrEqual(1)
  expect(salaryPre.totalDebit).toBeGreaterThan(0)

  const drainPre = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d) => (window as any).__uclife__.runFleetSupplyDrainTick(d),
    SALARY_TICK_DAY_PRE,
  )
  const drainPreCount = drainPre.shipsDraining
  expect(drainPreCount).toBeGreaterThanOrEqual(1)

  const mothA = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.setShipMothballedViaDebug(k, true),
    shipAKey,
  )
  expect(mothA.ok, `mothball A failed: ${JSON.stringify(mothA)}`).toBeTruthy()
  expect(mothA.mothballed).toBe(true)
  const isMothA = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.isShipMothballed(k),
    shipAKey,
  )
  expect(isMothA).toBe(true)

  const wrPost = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.warRoomDescribe(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aRowPost = wrPost.ships.find((r: any) => r.entityKey === shipAKey)
  expect(aRowPost?.isInActiveFleet, `Ship A still in active fleet after mothball`).toBeFalsy()
  expect(aRowPost?.formationSlot).toBe(-1)

  const mothFlag = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.setShipMothballedViaDebug(k, true),
    flagshipKey,
  )
  expect(mothFlag.ok, `flagship mothball should have been refused`).toBeFalsy()
  expect(mothFlag.reason).toBe('flagship_locked')

  const salaryPost = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d) => (window as any).__uclife__.runFactionSalaryTick(d),
    SALARY_TICK_DAY_POST,
  )
  expect(salaryPost.captainsPaid).toBe(0)
  expect(salaryPost.crewPaid).toBe(0)
  expect(salaryPost.totalDebit).toBe(0)

  const drainPost = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d) => (window as any).__uclife__.runFleetSupplyDrainTick(d),
    SALARY_TICK_DAY_POST,
  )
  expect(drainPost.shipsDraining).toBeLessThan(drainPreCount)

  const unmothA = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.setShipMothballedViaDebug(k, false),
    shipAKey,
  )
  expect(unmothA.ok, `un-mothball A failed: ${JSON.stringify(unmothA)}`).toBeTruthy()
  const isMothPostUn = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.isShipMothballed(k),
    shipAKey,
  )
  expect(isMothPostUn).toBe(false)

  const salaryReact = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d) => (window as any).__uclife__.runFactionSalaryTick(d),
    SALARY_TICK_DAY_RESUMED,
  )
  expect(salaryReact.totalDebit).toBeGreaterThan(0)

  const repromote = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.setIsInActiveFleet(k, true),
    shipAKey,
  )
  expect(repromote.ok, `re-promote Ship A to active fleet failed: ${JSON.stringify(repromote)}`).toBeTruthy()

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.setIsInActiveFleet(k, false),
    shipAKey,
  )

  const destsForA = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.listTransferDestinationsViaDebug(k),
    shipAKey,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drydockDest = destsForA.find((d: any) => d.poiId === 'vonBraunDrydock')
  expect(drydockDest, `vonBraunDrydock not in transfer destinations for A`).toBeTruthy()
  expect(drydockDest.hasOpenSlot, `drydock destination reports no open slot pre-transfer`).toBeTruthy()

  const transferA = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([k, dest, day]) => (window as any).__uclife__.enqueueHangarTransferViaDebug(k, dest, day),
    [shipAKey, 'vonBraunDrydock', TRANSFER_ORDER_DAY],
  )
  expect(transferA.ok, `transfer A → drydock failed: ${JSON.stringify(transferA)}`).toBeTruthy()
  expect(transferA.totalCost).toBe(transferA.transferFee + transferA.transitFee)
  expect(transferA.arrivalDay).toBeGreaterThan(TRANSFER_ORDER_DAY)

  const fleetMid = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listShipsInFleet(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aMid = fleetMid.find((s: any) => s.entityKey === shipAKey)
  expect(aMid && aMid.dockedAtPoiId === '', `Ship A not undocked after transfer`).toBeTruthy()

  const transitsMid = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fleetTransitDescribe(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tMid = transitsMid.find((t: any) => t.shipKey === shipAKey)
  expect(tMid, `Ship A not in transit list`).toBeTruthy()
  expect(tMid.originPoiId).toBe('vonBraun')
  expect(tMid.destinationPoiId).toBe('vonBraunDrydock')

  const transferInTransit = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([k, day]) => (window as any).__uclife__.enqueueHangarTransferViaDebug(k, 'vonBraunDrydock', day),
    [shipAKey, TRANSFER_ORDER_DAY],
  )
  expect(transferInTransit.ok, `transfer of in-transit ship should be refused`).toBeFalsy()
  expect(
    ['in_transit', 'already_in_transit'].includes(transferInTransit.reason),
    `transfer of in-transit refused with unexpected reason: ${transferInTransit.reason}`,
  ).toBeTruthy()

  const landResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (day) => (window as any).__uclife__.runFleetTransitTick(day),
    transferA.arrivalDay,
  )
  expect(landResult.landed).toBeGreaterThanOrEqual(1)
  const fleetPost = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listShipsInFleet(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aPost = fleetPost.find((s: any) => s.entityKey === shipAKey)
  expect(aPost?.dockedAtPoiId).toBe('vonBraunDrydock')

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.setShipMothballedViaDebug(k, true),
    shipAKey,
  )
  const transferMoth = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([k, day]) => (window as any).__uclife__.enqueueHangarTransferViaDebug(k, 'vonBraun', day),
    [shipAKey, MOTH_TRANSFER_ORDER_DAY],
  )
  expect(transferMoth.ok, `transfer of mothballed ship should be refused`).toBeFalsy()
  expect(transferMoth.reason).toBe('mothballed')

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.setShipMothballedViaDebug(k, false),
    shipAKey,
  )
  await sim.page.evaluate(
    (cap) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.forceFillHangarSlots('vonBraun', 'lunarMilitia', cap),
    VB_FILL_CAP,
  )
  const destsFull = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.listTransferDestinationsViaDebug(k),
    shipAKey,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vbDestFull = destsFull.find((d: any) => d.poiId === 'vonBraun')
  expect(vbDestFull, `vonBraun missing from transfer destinations after fill`).toBeTruthy()
  expect(vbDestFull.hasOpenSlot, `vonBraun should report no open slot after fill`).toBeFalsy()

  const transferFull = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ([k, day]) => (window as any).__uclife__.enqueueHangarTransferViaDebug(k, 'vonBraun', day),
    [shipAKey, FULL_TRANSFER_ORDER_DAY],
  )
  expect(transferFull.ok, `transfer to full hangar should be refused`).toBeFalsy()
  expect(transferFull.reason).toBe('dest_no_slot')

  await sim.page.evaluate(
    (arg) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.enqueueShipDelivery(arg.k, 'lunarMilitia', arg.orderDay, arg.lead),
    { k: drydock.buildingKey, orderDay: SHIP_B_ORDER_DAY, lead: SMALL_HULL_LEAD_DAYS },
  )
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d) => (window as any).__uclife__.runShipDeliveryTick(d),
    SHIP_B_ARRIVAL_DAY,
  )
  const rxB = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.receiveShipDelivery(k, 0),
    drydock.buildingKey,
  )
  expect(rxB.ok, `Ship B receive failed: ${JSON.stringify(rxB)}`).toBeTruthy()

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.setShipMothballedViaDebug(k, true),
    shipAKey,
  )

  const aPreSave = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.isShipMothballed(k),
    shipAKey,
  )
  expect(aPreSave).toBe(true)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(async () => { await (window as any).__uclife__.saveGame('auto') })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(async () => { await (window as any).__uclife__.loadGame('auto') })

  await sim.waitForBoot(['__uclife__.isShipMothballed'])

  const aPostLoad = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.isShipMothballed(k),
    shipAKey,
  )
  expect(aPostLoad).toBe(true)
})
