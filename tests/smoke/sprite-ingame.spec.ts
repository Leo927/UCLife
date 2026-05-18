// Renderer-pixel: ingame LPC sprites. Boots via ?test=1&assets=1 so the
// in-game ground renderer actually requests + composes LPC sprites for
// spawned NPCs. Assertion is on captured /lpc/ HTTP responses.

import { test, expect } from './_fixtures'

const ASSET_DRAIN_TIMEOUT_MS = 30_000

const REQUIRED_HANDLES = [
  '__uclife__.awaitAssetsReady',
  '__uclife__.pendingAssetJobs',
  '__uclife__.countByKind',
]

test('LPC ingame: ground renderer requests composeSheet for NPCs', async ({ sim }) => {
  // Capture every /lpc/ response. Listener attached BEFORE boot so requests
  // during the initial navigation aren't missed.
  const lpcRequests: Array<{ url: string; status: number }> = []
  sim.page.on('response', (r) => {
    const u = r.url()
    if (u.includes('/lpc/')) lpcRequests.push({ url: u, status: r.status() })
  })

  // Wait for the FIRST /lpc/ response as a deterministic "renderer ticked"
  // signal. RAF-yield gating was racy under cold Vite caches (the renderer
  // may take >2 RAFs to schedule its first composeSheet batch when sprite
  // routes haven't been served yet).
  const firstLpc = sim.page.waitForResponse(
    (r) => r.url().includes('/lpc/'),
    { timeout: 30_000 },
  )

  await sim.boot({ params: { assets: 1 }, requireHandles: REQUIRED_HANDLES })
  await firstLpc

  // Drain the rest of the in-flight sprite jobs.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (t) => (window as any).__uclife__.awaitAssetsReady({ timeoutMs: t }),
    ASSET_DRAIN_TIMEOUT_MS,
  )

  expect(lpcRequests.length, 'no LPC requests — sprites never composed').toBeGreaterThan(0)
  const failCount = lpcRequests.filter((r) => r.status !== 200).length
  expect(failCount, `${failCount} sprite requests returned non-200`).toBe(0)
})
