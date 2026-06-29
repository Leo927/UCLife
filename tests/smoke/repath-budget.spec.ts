import { test, expect } from './_fixtures'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = any

// Issue #152: per-frame NPC repath budget + player priority.
//
// 1. Budget invariant — a burst of N≫K simultaneous NPC repaths must never
//    push more than K findPath calls into a single movementSystem() invocation.
//    Deferred NPCs keep their MoveTarget and retry the following frame.
// 2. Player priority — the player's repath is never deferred regardless of how
//    many NPCs are competing for the same frame budget.
test('NPC repath budget caps per-frame pathfinds; player is never deferred', async ({ sim }) => {
  await sim.boot({
    fixture: 'player-with-cash-at-vb',
    requireHandles: [
      '__uclife_test__.step',
      '__uclife__.enableRepathStats',
      '__uclife__.repathBudgetStats',
      '__uclife__.forceNpcRepathBurst',
      '__uclife__.drivePlayerToTile',
    ],
  })

  // Activate per-frame repath counters.
  await sim.page.evaluate(() => (window as Win).__uclife__.enableRepathStats(true))

  // Drive 20 NPCs to a far tile simultaneously — well above the default budget
  // of 8 — so deferral is exercised in the very next tick.
  const BURST_N = 20
  const FAR_TILE = { x: 50, y: 50 }
  const targeted: number = await sim.page.evaluate(
    ({ n, tile }) => (window as Win).__uclife__.forceNpcRepathBurst(n, tile),
    { n: BURST_N, tile: FAR_TILE },
  )

  // Give the player a new destination so it also needs a repath this tick.
  const playerDriven: boolean = await sim.page.evaluate(
    (tile) => (window as Win).__uclife__.drivePlayerToTile(tile),
    { x: 5, y: 5 },
  )
  expect(playerDriven, 'player should exist in the fixture scene').toBe(true)

  // Advance one game minute — runs movementSystem() exactly once.
  await sim.stepFor(1)

  const stats: {
    playerRepaths: number
    npcRepathsRun: number
    npcRepathsDeferred: number
    budgetK: number
  } = await sim.page.evaluate(() => (window as Win).__uclife__.repathBudgetStats())

  // The fixture must have enough NPCs to make the burst meaningful.
  expect(
    targeted,
    `fixture should expose > ${stats.budgetK} NPCs for a meaningful burst (got ${targeted})`,
  ).toBeGreaterThan(stats.budgetK)

  // Budget invariant: no single frame runs more than K NPC pathfinds.
  expect(
    stats.npcRepathsRun,
    `NPC repaths per frame must not exceed budgetK=${stats.budgetK}`,
  ).toBeLessThanOrEqual(stats.budgetK)

  // Player priority: the player's repath is always served, never deferred.
  expect(
    stats.playerRepaths,
    'player repath must be served in the frame it was issued (never deferred)',
  ).toBe(1)

  // Deferral accounting: at least (targeted − K) NPCs were pushed to the next frame.
  expect(
    stats.npcRepathsDeferred,
    `at least ${targeted - stats.budgetK} NPCs should be deferred when targeted=${targeted} > budgetK=${stats.budgetK}`,
  ).toBeGreaterThanOrEqual(targeted - stats.budgetK)
})
