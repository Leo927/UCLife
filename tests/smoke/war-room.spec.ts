// war-room plot table + IsInActiveFleet + aggression smoke.

import { test, expect } from './_fixtures'

const DRYDOCK_DELIVERY_DAYS = 1
const DRYDOCK_RUN_TICK_DAY = 6
const PROMOTE_SLOT_TOPLEFT = 0
const SAVE_RESTORE_SLOT = 2
const STARTUP_MONEY = 2_000_000

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.fillJobVacancies',
  '__uclife__.listShipsInFleet',
  '__uclife__.listHangarsAllScenes',
  '__uclife__.enqueueShipDelivery',
  '__uclife__.runShipDeliveryTick',
  '__uclife__.receiveShipDelivery',
  '__uclife__.warRoomDescribe',
  '__uclife__.setIsInActiveFleet',
  '__uclife__.setFormationSlot',
  '__uclife__.setShipAggression',
  '__uclife__.setWarRoomOpen',
  '__uclife__.fleetRosterSnapshot',
  '__uclife__.cheatMoney',
  '__uclife__.saveGame',
  '__uclife__.loadGame',
]

test('war-room: plot table, IsInActiveFleet, aggression, save round-trip', async ({ sim }) => {
  await sim.boot({ requireHandles: REQUIRED_HANDLES })

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (amt) => (window as any).__uclife__.cheatMoney(amt),
    STARTUP_MONEY,
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

  const snap0 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.warRoomDescribe(),
  )
  expect(typeof snap0.flagshipSlot, `warRoomDescribe missing flagshipSlot`).toBe('number')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flagshipRow0 = snap0.ships.find((r: any) => r.entityKey === flagshipKey)
  expect(flagshipRow0?.isFlagship, 'flagship row missing isFlagship marker').toBeTruthy()
  expect(flagshipRow0.isInActiveFleet, 'flagship not in active fleet at boot').toBeTruthy()
  expect(flagshipRow0.formationSlot).toBe(snap0.flagshipSlot)
  expect(snap0.occupancy[snap0.flagshipSlot]).toBe(flagshipKey)

  const hangars = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listHangarsAllScenes(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drydock = hangars.find((h: any) => h.typeId === 'hangarDrydock')
  expect(drydock, 'Von Braun drydock missing').toBeTruthy()

  await sim.page.evaluate(
    (args) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.enqueueShipDelivery(args.k, 'pegasusClass', args.days, 5),
    { k: drydock.buildingKey, days: DRYDOCK_DELIVERY_DAYS },
  )
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (day) => (window as any).__uclife__.runShipDeliveryTick(day),
    DRYDOCK_RUN_TICK_DAY,
  )
  const rx = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.receiveShipDelivery(k, 0),
    drydock.buildingKey,
  )
  expect(rx.ok, `pegasus receive failed: ${JSON.stringify(rx)}`).toBe(true)
  const pegasusKey = rx.entityKey

  const snap1 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.warRoomDescribe(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pegRow1 = snap1.ships.find((r: any) => r.entityKey === pegasusKey)
  expect(pegRow1, 'pegasus row missing').toBeTruthy()
  expect(pegRow1.isInActiveFleet).toBe(false)
  expect(pegRow1.formationSlot).toBe(-1)
  expect(pegRow1.aggression).toBe('steady')

  const promote0 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (args) => (window as any).__uclife__.setIsInActiveFleet(args.key, true, args.slot),
    { key: pegasusKey, slot: PROMOTE_SLOT_TOPLEFT },
  )
  expect(promote0.ok, `promote pegasus failed`).toBe(true)
  expect(promote0.formationSlot).toBe(PROMOTE_SLOT_TOPLEFT)

  const snap2 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.warRoomDescribe(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pegRow2 = snap2.ships.find((r: any) => r.entityKey === pegasusKey)
  expect(pegRow2.isInActiveFleet).toBeTruthy()
  expect(pegRow2.formationSlot).toBe(PROMOTE_SLOT_TOPLEFT)
  expect(snap2.occupancy[PROMOTE_SLOT_TOPLEFT]).toBe(pegasusKey)

  const demote = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.setIsInActiveFleet(k, false),
    pegasusKey,
  )
  expect(demote.ok, `demote pegasus failed`).toBe(true)

  const snap3 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.warRoomDescribe(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pegRow3 = snap3.ships.find((r: any) => r.entityKey === pegasusKey)
  expect(pegRow3.isInActiveFleet).toBe(false)
  expect(pegRow3.formationSlot).toBe(-1)
  expect(!snap3.occupancy[PROMOTE_SLOT_TOPLEFT]).toBeTruthy()

  const autoPromote = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.setIsInActiveFleet(k, true),
    pegasusKey,
  )
  expect(autoPromote.ok, `auto-promote pegasus failed`).toBe(true)
  expect(autoPromote.formationSlot).toBeGreaterThanOrEqual(0)
  expect(autoPromote.formationSlot).not.toBe(snap0.flagshipSlot)

  const flagshipDemote = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.setIsInActiveFleet(k, false),
    flagshipKey,
  )
  expect(flagshipDemote.ok, `flagship demote should have been rejected`).toBe(false)
  expect(flagshipDemote.reason).toBe('flagship_locked')

  const snap4 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.warRoomDescribe(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fl4 = snap4.ships.find((r: any) => r.entityKey === flagshipKey)
  expect(fl4.isInActiveFleet, 'flagship lost active marker after rejected demote').toBeTruthy()
  expect(fl4.formationSlot).toBe(snap4.flagshipSlot)

  const collide = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (args) => (window as any).__uclife__.setFormationSlot(args.key, args.slot),
    { key: pegasusKey, slot: snap4.flagshipSlot },
  )
  expect(collide.ok, `moving pegasus onto flagship slot should reject`).toBe(false)
  expect(collide.reason).toBe('slot_occupied')

  const move = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (args) => (window as any).__uclife__.setFormationSlot(args.key, args.slot),
    { key: pegasusKey, slot: PROMOTE_SLOT_TOPLEFT },
  )
  expect(move.ok, `setFormationSlot to free slot failed`).toBe(true)
  expect(move.formationSlot).toBe(PROMOTE_SLOT_TOPLEFT)

  for (const level of ['cautious', 'steady', 'aggressive']) {
    const r = await sim.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (args) => (window as any).__uclife__.setShipAggression(args.key, args.level),
      { key: pegasusKey, level },
    )
    expect(r.ok, `setAggression(${level}) failed`).toBe(true)
    expect(r.aggression).toBe(level)
    const sn = await sim.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__uclife__.warRoomDescribe(),
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = sn.ships.find((s: any) => s.entityKey === pegasusKey)
    expect(row.aggression).toBe(level)
  }

  const badAgg = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (args) => (window as any).__uclife__.setShipAggression(args.key, args.level),
    { key: pegasusKey, level: 'berserk' },
  )
  expect(badAgg.ok, 'setAggression accepted invalid level').toBe(false)
  expect(badAgg.reason).toBe('invalid_aggression')

  const opened = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.setWarRoomOpen(true),
  )
  expect(opened).toBe(true)
  const closed = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.setWarRoomOpen(false),
  )
  expect(closed).toBe(false)

  const roster = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fleetRosterSnapshot(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pegRosterRow = roster.find((r: any) => r.entityKey === pegasusKey)
  expect(pegRosterRow, 'pegasus missing from fleetRosterSnapshot').toBeTruthy()

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (args) => (window as any).__uclife__.setFormationSlot(args.key, args.slot),
    { key: pegasusKey, slot: SAVE_RESTORE_SLOT },
  )
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (args) => (window as any).__uclife__.setShipAggression(args.key, args.level),
    { key: pegasusKey, level: 'aggressive' },
  )

  const preSave = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.warRoomDescribe(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const preSavePeg = preSave.ships.find((r: any) => r.entityKey === pegasusKey)
  expect(preSavePeg.isInActiveFleet).toBeTruthy()
  expect(preSavePeg.formationSlot).toBe(SAVE_RESTORE_SLOT)
  expect(preSavePeg.aggression).toBe('aggressive')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(async () => { await (window as any).__uclife__.saveGame('auto') })
  const loadRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async () => (window as any).__uclife__.loadGame('auto'),
  )
  expect(loadRes.ok, `loadGame failed: ${JSON.stringify(loadRes)}`).toBe(true)

  const postLoad = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.warRoomDescribe(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const postPeg = postLoad.ships.find((r: any) => r.entityKey === pegasusKey)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const postFl = postLoad.ships.find((r: any) => r.entityKey === flagshipKey)
  expect(postPeg, 'save round-trip: pegasus missing').toBeTruthy()
  expect(postPeg.isInActiveFleet).toBeTruthy()
  expect(postPeg.formationSlot).toBe(SAVE_RESTORE_SLOT)
  expect(postPeg.aggression).toBe('aggressive')
  expect(postFl, 'save round-trip: flagship missing').toBeTruthy()
  expect(postFl.isInActiveFleet).toBeTruthy()
  expect(postFl.formationSlot).toBe(postLoad.flagshipSlot)
})
