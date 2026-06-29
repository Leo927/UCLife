import { test, expect } from './_fixtures'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = any

// After scene activation the HPA cluster graph must already be built so the
// player's first pathfind does not pay the one-time ~135 ms rebuild cost.
// Verified by asserting hpaBuildCount > 0 at boot time and unchanged after
// a successful pathfind.
test('HPA cluster graph is pre-warmed at scene boot; first pathfind does not rebuild', async ({ sim }) => {
  await sim.boot({
    fixture: 'player-with-cash-at-vb',
    requireHandles: [
      '__uclife_test__.step',
      '__uclife__.hpaBuildCount',
      '__uclife__.pfDiagOpenProbe',
    ],
  })

  const countAfterBoot = await sim.page.evaluate(() => (window as Win).__uclife__.hpaBuildCount())
  expect(
    countAfterBoot,
    'HPA cluster graph must be built at least once during scene activation (pre-warm)',
  ).toBeGreaterThan(0)

  const open = await sim.page.evaluate(() => (window as Win).__uclife__.pfDiagOpenProbe())
  expect(open.found, 'a reachable open target near the player must exist').toBe(true)

  const countAfterPathfind = await sim.page.evaluate(() => (window as Win).__uclife__.hpaBuildCount())
  expect(
    countAfterPathfind,
    'first player pathfind must not trigger a new cluster build — graph was already warm',
  ).toBe(countAfterBoot)
})
