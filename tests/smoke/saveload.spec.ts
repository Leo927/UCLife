/**
 * Save → advance sim time → load → verify the clock round-tripped.
 * Driven entirely through the deterministic test runtime — clock is
 * frozen by ?test=1, step() advances sim time, saveGame/loadGame run
 * the same code path as the system menu.
 */
import { test, expect } from './_fixtures'

// Kept small on purpose: the invariant is "the clock moved, load put it
// back", and every simulated minute here ticks the full default city.
// At 60 minutes this spec ran at 45s of its 60s budget on CI — one
// worker-scheduling shift away from a spurious red.
const MINUTES_ADVANCED = 5
const SAVE_SLOT = 1

test('save → advance → load restores the clock', async ({ sim }) => {
  await sim.boot({
    requireHandles: [
      '__uclife_test__.step',
      '__uclife__.saveGame',
      '__uclife__.loadGame',
      '__uclife__.getGameState',
    ],
  })

  const readClock = () => sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.useClock.getState().gameDate.getTime(),
  )

  const savedClock = await readClock()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(async (slot) => { await (window as any).__uclife__.saveGame(slot) }, SAVE_SLOT)

  await sim.stepFor(MINUTES_ADVANCED)
  const advancedClock = await readClock()
  expect(advancedClock, `step({ gameMinutes }) should advance the clock; both = ${savedClock}`)
    .not.toBe(savedClock)

  const loadResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (slot) => (window as any).__uclife__.loadGame(slot),
    SAVE_SLOT,
  )
  expect(loadResult.ok, `loadGame failed: ${JSON.stringify(loadResult)}`).toBe(true)

  const reloadedClock = await readClock()
  expect(reloadedClock, `reloaded clock ${reloadedClock} != saved ${savedClock}`).toBe(savedClock)
})
