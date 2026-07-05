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
