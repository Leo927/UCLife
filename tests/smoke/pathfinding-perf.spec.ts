import { test, expect } from './_fixtures'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = any

// Regression gate for the perf fixes that landed in issues #152 and #153.
// All assertions are on deterministic counts — never wall-clock ms — so the
// suite passes 1/1 on any CI runner load.
//
// Substrate note: sim.stepFor / stepUntil call advanceSimByGameMs which
// mirrors frame()'s system calls. hpaStats and movementStats are populated
// by movementSystem (called inside advanceSimByGameMs). The frame profiler's
// sim* stages (inside loop.ts frame()) are NOT populated; do not assert on
// getFrameStats here.
//
// Uses the 'heavy-npc' fixture (20 named NPCs, seed-deterministic) so the
// burst test has a controlled worst-case N independent of the procgen NPC pool.

// #153 gate — HPA* pre-warm eliminates first-click cluster rebuild.
// After warmHpa() runs at scene activation, buildClustersIfNeeded returns
// early (dirty=false, clusters populated) — no rebuild on the first repath.
test('HPA* pre-warm: first interactive repath skips cluster rebuild (regression gate #153)', async ({ sim }) => {
  await sim.boot({
    fixture: 'heavy-npc',
    requireHandles: [
      '__uclife_test__.step',
      '__uclife__.getClusterBuildCount',
      '__uclife__.pfDiagOpenProbe',
    ],
  })

  const countAfterBoot = await sim.page.evaluate(
    () => (window as Win).__uclife__.getClusterBuildCount(),
  )
  expect(
    countAfterBoot,
    'cluster graph must be built during scene boot warm — count must be > 0',
  ).toBeGreaterThan(0)

  // pfDiagOpenProbe issues a findPath → hpaFind → buildClustersIfNeeded.
  // With pre-warm active the graph is current; buildClustersIfNeeded returns
  // early and the count stays unchanged.
  const open = await sim.page.evaluate(
    () => (window as Win).__uclife__.pfDiagOpenProbe(),
  )
  expect(open.found, 'a reachable target must exist near the player').toBe(true)

  const countAfterPathfind = await sim.page.evaluate(
    () => (window as Win).__uclife__.getClusterBuildCount(),
  )
  expect(
    countAfterPathfind,
    'first interactive pathfind must NOT trigger a cluster rebuild — pre-warm already covered it',
  ).toBe(countAfterBoot)
})

// #152 gate — per-frame NPC repath budget caps simultaneous repaths.
// When N >> K NPCs all need a repath in the same tick:
//   - movementSystem runs exactly K of them (budget enforced)
//   - the player's repath is always served first (never deferred)
//   - the remaining N − K are deferred to the next tick
test('repath budget: NPC burst ≤ K per tick; player repath never deferred (regression gate #152)', async ({ sim }) => {
  await sim.boot({
    fixture: 'heavy-npc',
    requireHandles: [
      '__uclife_test__.step',
      '__uclife__.enableRepathStats',
      '__uclife__.repathBudgetStats',
      '__uclife__.forceNpcRepathBurst',
      '__uclife__.drivePlayerToTile',
    ],
  })

  await sim.page.evaluate(() => (window as Win).__uclife__.enableRepathStats(true))

  // Force all 20 fixture NPCs (plus any procedural ones) to repath
  // simultaneously — well above the default budget of 8.
  const BURST_N = 20
  const FAR_TILE = { x: 60, y: 60 }
  const targeted: number = await sim.page.evaluate(
    ({ n, tile }) => (window as Win).__uclife__.forceNpcRepathBurst(n, tile),
    { n: BURST_N, tile: FAR_TILE },
  )

  // Also drive the player to a new tile so it competes for the budget.
  const playerDriven: boolean = await sim.page.evaluate(
    (tile) => (window as Win).__uclife__.drivePlayerToTile(tile),
    { x: 5, y: 5 },
  )
  expect(playerDriven, 'player must exist in the heavy-npc fixture scene').toBe(true)

  // One game-minute tick — runs movementSystem() exactly once.
  await sim.stepFor(1)

  const stats: {
    playerRepaths: number
    npcRepathsRun: number
    npcRepathsDeferred: number
    budgetK: number
  } = await sim.page.evaluate(() => (window as Win).__uclife__.repathBudgetStats())

  // The fixture must expose enough NPCs for a meaningful burst.
  expect(
    targeted,
    `heavy-npc fixture must expose > ${stats.budgetK} NPCs for a burst test (got ${targeted})`,
  ).toBeGreaterThan(stats.budgetK)

  // Budget invariant: a single movementSystem() tick must run ≤ K NPC repaths.
  expect(
    stats.npcRepathsRun,
    `NPC repaths in one tick must not exceed budgetK=${stats.budgetK}`,
  ).toBeLessThanOrEqual(stats.budgetK)

  // Player priority: the player's repath is always served; never pushed to the next frame.
  expect(
    stats.playerRepaths,
    'player repath must be served in the tick it was issued (never deferred by NPC budget)',
  ).toBe(1)

  // Deferral accounting: at least targeted − K NPCs must have been deferred.
  expect(
    stats.npcRepathsDeferred,
    `at least ${targeted - stats.budgetK} NPCs must be deferred when ${targeted} > budgetK=${stats.budgetK}`,
  ).toBeGreaterThanOrEqual(targeted - stats.budgetK)
})
