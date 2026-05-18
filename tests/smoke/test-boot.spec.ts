/**
 * Verifies the `?test=1` boot path lands a working runtime + debug-handle
 * surface and the sim clock is frozen:
 *
 *   1. __uclife_test__.step is a function — the sole wait primitive.
 *   2. __uclife__.getGameState is a function — Phase 5 stub still wires it.
 *   3. __uclife__.getEntityScreenCoords is a function — world→screen bridge.
 *   4. __uclife__.pendingAssetJobs() === 0 — asset pipelines never started.
 *   5. step({ gameMinutes: 1 }) advances simNow by exactly 60_000 ms.
 */
import { test, expect, MS_PER_GAME_MINUTE } from './_fixtures'

test('?test=1 boot exposes deterministic handles + frozen clock', async ({ sim }) => {
  await sim.boot({
    requireHandles: [
      '__uclife_test__.step',
      '__uclife__.getGameState',
      '__uclife__.getEntityScreenCoords',
      '__uclife__.pendingAssetJobs',
    ],
  })

  // 1. Asset pipelines never started — skipAssets default-on.
  const pendingJobs = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.pendingAssetJobs(),
  )
  expect(pendingJobs, 'asset pipelines should not start in test mode').toBe(0)

  // 2. Surface diagnostics for the runtime namespace.
  const surface = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    return {
      hasStep: typeof w.__uclife_test__?.step === 'function',
      hasGetGameState: typeof w.__uclife__?.getGameState === 'function',
      hasGetEntityScreenCoords: typeof w.__uclife__?.getEntityScreenCoords === 'function',
      hasAwaitAssetsReady: typeof w.__uclife__?.awaitAssetsReady === 'function',
    }
  })
  expect(surface).toEqual({
    hasStep: true,
    hasGetGameState: true,
    hasGetEntityScreenCoords: true,
    hasAwaitAssetsReady: true,
  })

  // 3. step({ gameMinutes: 1 }) advances simNow by exactly 60_000 ms.
  const advance = await sim.page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const before = w.__uclife__.useClock.getState().gameDate.getTime()
    await w.__uclife_test__.step({ gameMinutes: 1 })
    const after = w.__uclife__.useClock.getState().gameDate.getTime()
    return { before, after, delta: after - before }
  })
  expect(
    advance.delta,
    `step({ gameMinutes: 1 }) advanced clock by ${advance.delta} ms; before=${advance.before} after=${advance.after}`,
  ).toBe(MS_PER_GAME_MINUTE)
})
