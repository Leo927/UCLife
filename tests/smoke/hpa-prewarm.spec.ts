import { test, expect } from './_fixtures'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = any

// Verifies the HPA* cluster graph is pre-warmed at scene boot/activation so
// the first interactive pathfind reads a warm graph rather than paying the
// ~135 ms cluster-build cost on the click frame.
test('HPA* cluster graph is pre-warmed at scene activation — first repath skips rebuild', async ({ sim }) => {
  await sim.boot({
    fixture: 'player-with-cash-at-vb',
    requireHandles: [
      '__uclife_test__.step',
      '__uclife__.getClusterBuildCount',
      '__uclife__.pfDiagOpenProbe',
    ],
  })

  // The cluster graph must be built at boot time (by the warm in setupWorld),
  // not deferred to the first player click.
  const countAfterBoot = await sim.page.evaluate(
    () => (window as Win).__uclife__.getClusterBuildCount(),
  )
  expect(
    countAfterBoot,
    'cluster graph must be built during scene boot warm — count must be > 0',
  ).toBeGreaterThan(0)

  // Run an interactive pathfind via the probe (findPath → hpaFind →
  // buildClustersIfNeeded). With the pre-warm in place, the graph is already
  // current and buildClustersIfNeeded returns early — count stays unchanged.
  const open = await sim.page.evaluate(
    () => (window as Win).__uclife__.pfDiagOpenProbe(),
  )
  expect(open.found, 'a reachable target must exist near the player').toBe(true)

  const countAfterPathfind = await sim.page.evaluate(
    () => (window as Win).__uclife__.getClusterBuildCount(),
  )
  expect(
    countAfterPathfind,
    'first interactive pathfind must NOT trigger a cluster rebuild (pre-warm covered it)',
  ).toBe(countAfterBoot)
})
