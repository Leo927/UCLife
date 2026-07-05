import { test, expect } from './_fixtures'

// W1 Task 5 — the flagship is bought at the AE broker, not granted at boot.
// A fresh boot must own no ship, and the ship / fleet systems must tolerate
// the no-ship state without crashing:
//   - per-tick systems (supply drain, ship-marker sync, space sim) run while
//     the sim advances a few minutes;
//   - the day-rollover ship/fleet systems are driven directly (a full game
//     day is 5.4M frozen-clock ticks — impractical to step) via their debug
//     force-handles.
// The fixture teardown page-error gate is the crash detector.
const DAILY_HANDLES = [
  '__uclife__.runShipDeliveryTick',
  '__uclife__.runFleetSupplyTick',
  '__uclife__.runFleetSupplyDrainTick',
  '__uclife__.runFleetTransitTick',
  '__uclife__.runHangarRepairTick',
  '__uclife__.runMsDeliveryTick',
  '__uclife__.runMsTransitTick',
]

const REQUIRED_HANDLES = ['__uclife_test__.step', '__uclife__.getGameState', ...DAILY_HANDLES]

const ROLLOVER_DAY = 1

test('fresh boot owns no ship; ship systems stay inert without crashing', async ({ sim }) => {
  await sim.boot({ requireHandles: REQUIRED_HANDLES }) // no fixture — plain test-mode boot

  const ownsShip = await sim.page.evaluate(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__uclife__.getGameState().getPlayerFleet().getShipCount() > 0)
  expect(ownsShip, 'fresh boot must not own a boot-granted flagship').toBe(false)

  // Per-tick ship systems run every tick — advance a few minutes so they
  // exercise the no-ship state.
  await sim.stepFor(15)

  // Day-rollover ship/fleet systems must also tolerate the no-ship state.
  const dailyOk = await sim.page.evaluate((day: number) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = (window as any).__uclife__
    u.runShipDeliveryTick(day)
    u.runFleetSupplyTick(day)
    u.runFleetSupplyDrainTick(day)
    u.runFleetTransitTick(day)
    u.runHangarRepairTick(day)
    u.runMsDeliveryTick(day)
    u.runMsTransitTick(day)
    return true
  }, ROLLOVER_DAY)
  expect(dailyOk, 'daily ship/fleet systems must run without throwing on a no-ship world').toBe(true)

  const stillNoShip = await sim.page.evaluate(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__uclife__.getGameState().getPlayerFleet().getShipCount() > 0)
  expect(stillNoShip, 'no ship should have materialized from the daily systems').toBe(false)
  // teardown page-error gate proves nothing crashed
})

// W1 Task 5 review finding 1 — the first hull a player buys is delivered as
// a RESERVE ship (no IsInActiveFleet, formationSlot: -1). recomputeFleetPool
// only sums IsInActiveFleet ships, so the delivered-fueled top-up that fires
// on first receipt (grantFirstHullOnboarding) summed an empty active roster
// and landed a 0/0 fleet pool. Boarding that hull must leave the player with
// a usable tank, not a stranded flagship.
const FIRST_HULL_ORDER_DAY = 1
const FIRST_HULL_LEAD_DAYS = 3
const FIRST_HULL_ARRIVAL_DAY = FIRST_HULL_ORDER_DAY + FIRST_HULL_LEAD_DAYS
const FIRST_HULL_CLASS = 'lightFreighter'
const FIRST_HULL_HANGAR_TYPE = 'hangarSurface'

const FIRST_HULL_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.listHangarsAllScenes',
  '__uclife__.enqueueShipDelivery',
  '__uclife__.runShipDeliveryTick',
  '__uclife__.receiveShipDelivery',
  '__uclife__.boardShipByKey',
  '__uclife__.fleetFuelPool',
]

test('first-hull onboarding: bought, delivered, boarded hull has a usable fuel tank', async ({ sim }) => {
  await sim.boot({ requireHandles: FIRST_HULL_HANDLES }) // no fixture — plain test-mode boot

  const hangars = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listHangarsAllScenes(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vb = hangars.find((h: any) => h.typeId === FIRST_HULL_HANGAR_TYPE)
  expect(vb, 'VB state hangar missing').toBeTruthy()

  const enq = await sim.page.evaluate(
    (arg) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.enqueueShipDelivery(arg.k, arg.cls, arg.orderDay, arg.lead),
    { k: vb.buildingKey, cls: FIRST_HULL_CLASS, orderDay: FIRST_HULL_ORDER_DAY, lead: FIRST_HULL_LEAD_DAYS },
  )
  expect(enq, 'enqueueShipDelivery rejected the first-hull buy').toBeTruthy()

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d) => (window as any).__uclife__.runShipDeliveryTick(d),
    FIRST_HULL_ARRIVAL_DAY,
  )

  const rx = await sim.page.evaluate(
    (arg) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.receiveShipDelivery(arg.k, arg.idx),
    { k: vb.buildingKey, idx: enq.rowIndex },
  )
  expect(rx.ok, `receiveShipDelivery failed: ${JSON.stringify(rx)}`).toBe(true)

  const boardResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (key) => (window as any).__uclife__.boardShipByKey(key),
    rx.entityKey,
  )
  expect(boardResult.ok, `boardShipByKey failed: ${boardResult.reasonZh ?? ''}`).toBe(true)

  const pool = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fleetFuelPool(),
  )
  expect(pool.fuelMax, 'first boarded hull must have a usable fuel tank capacity').toBeGreaterThan(0)
  expect(pool.fuelCurrent, 'first boarded hull must arrive with fuel in the tank').toBeGreaterThan(0)
})
