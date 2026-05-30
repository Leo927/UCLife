// Issue #69 — Command Points + Deployment Points wired into tactical +
// doctrine sliders fully active.
//
// 1. Boot a seeded combat fixture with a known active fleet + known player
//    skills; assert the DP cap matches the formula.
// 2. Commit ships up to the cap; assert an over-cap commit is refused.
// 3. Enter tactical; assert maxCommandPoints matches the formula.
// 4. Issue a fleet-wide order; assert CP debited; spend to zero; assert
//    further orders refused + a `CP exhausted` log entry is present.
// 5. Set one escort aggressive, one cautious; step the engagement; assert
//    the two close/hold differently (read off the deterministic handle).

import { test, expect, isKnownPixiBatcherStartup } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
  '__uclife__.listShipsInFleet',
  '__uclife__.setIsInActiveFleet',
  '__uclife__.setShipAggression',
  '__uclife__.computeDpCap',
  '__uclife__.deploymentDescribe',
  '__uclife__.commitShipToEngagement',
  '__uclife__.dpCostForShipKey',
  '__uclife__.computeMaxCommandPoints',
  '__uclife__.commandPoolDescribe',
  '__uclife__.issueFleetOrder',
  '__uclife__.combatLogEntries',
  '__uclife__.combatPlayerSideSnapshot',
  '__uclife__.doctrineForAggression',
  '__uclife__.startCombatCheat',
  '__uclife__.endCombatCheat',
]

// Formula constants from src/config/fleet.json5 with the cp-dp fixture
// (piloting level 50 — 5000 XP, no flagship comm officer):
//   dpCap          = 6 + floor(50/20) + 0          = 8
//   maxCommandPnts = floor(4 + 50/25 + 50/30 + 0)  = 7
const EXPECTED_DP_CAP = 8
const EXPECTED_MAX_CP = 7

test('CP/DP wired into tactical + doctrine sliders active', async ({ sim }) => {
  sim.allowConsoleError(isKnownPixiBatcherStartup)
  await sim.boot({ fixture: 'cp-dp', requireHandles: REQUIRED_HANDLES })

  // ── 0. Fleet sanity: flagship + two escorts present. ──────────────────
  const fleet = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listShipsInFleet(),
  )
  expect(fleet.length, `expected 3 ships in fleet; got ${fleet.length}`).toBe(3)

  // ── 1. DP cap matches the formula. ────────────────────────────────────
  const dpCap = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.computeDpCap(),
  )
  expect(dpCap, `DP cap should match the formula (piloting level 50)`).toBe(EXPECTED_DP_CAP)

  // dpCost projects from each class onto the ship's StatSheet.
  const dpA = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.dpCostForShipKey('escort-a'),
  )
  const dpB = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.dpCostForShipKey('escort-b'),
  )
  expect(dpA, 'escort-a (lunarMilitia) dpCost').toBe(2)
  expect(dpB, 'escort-b (pegasusClass) dpCost').toBe(10)

  // ── 2. Promote both escorts active; commit up to the cap; over-cap refused.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.setIsInActiveFleet('escort-a', true),
  )
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.setIsInActiveFleet('escort-b', true),
  )

  // Commit escort-a (dpCost 2) — fits under cap 8.
  const commitA = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.commitShipToEngagement('escort-a'),
  )
  expect(commitA.ok, `committing escort-a should succeed: ${JSON.stringify(commitA)}`).toBe(true)
  expect(commitA.committed).toBe(2)

  // Commit escort-b (dpCost 10) — 2 + 10 = 12 > cap 8 → refused, no debit.
  const commitB = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.commitShipToEngagement('escort-b'),
  )
  expect(commitB.ok, 'committing escort-b should be refused (over DP budget)').toBe(false)
  expect(commitB.reason).toBe('over_budget')

  const deployment = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.deploymentDescribe(),
  )
  expect(deployment.committed, 'over-cap commit must not change the committed total').toBe(2)
  expect(deployment.committedShipKeys).toContain('escort-a')
  expect(deployment.committedShipKeys).not.toContain('escort-b')

  // ── 3. Enter tactical; assert maxCommandPoints + seeded pool. ──────────
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.startCombatCheat('pirateLight', [], null, {}),
  )

  const maxCp = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.computeMaxCommandPoints(),
  )
  expect(maxCp, 'maxCommandPoints should match the formula').toBe(EXPECTED_MAX_CP)

  const pool0 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.commandPoolDescribe(),
  )
  expect(pool0.max, 'pool max seeded from formula').toBe(EXPECTED_MAX_CP)
  expect(pool0.current, 'pool seeded full at startCombat').toBe(EXPECTED_MAX_CP)

  // ── 4. Issue a fleet-wide order; assert CP debited; spend to zero;
  //       assert further orders refused + a `CP exhausted` log entry. ─────
  const order1 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.issueFleetOrder('rally'),
  )
  expect(order1.ok, `first rally order should debit: ${JSON.stringify(order1)}`).toBe(true)
  expect(order1.remaining, 'rally costs 1 CP').toBe(EXPECTED_MAX_CP - 1)

  // Drain the pool to zero with repeated orders (cost-agnostic loop).
  await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uu = (window as any).__uclife__
    let guard = 100
    while (uu.commandPoolDescribe().current > 0 && guard-- > 0) {
      const r = uu.issueFleetOrder('rally')
      if (!r.ok) break
    }
  })
  const drained = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.commandPoolDescribe(),
  )
  expect(drained.current, 'pool should be drained to zero').toBe(0)

  // Further order refused.
  const refused = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.issueFleetOrder('rally'),
  )
  expect(refused.ok, 'order with empty pool must be refused').toBe(false)
  expect(refused.reason).toBe('insufficient_cp')

  // `CP exhausted` log entry present (zh-CN: 指挥点耗尽).
  const log = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.combatLogEntries(),
  )
  expect(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    log.some((e: any) => e.textZh.includes('指挥点耗尽')),
    `expected a 'CP exhausted' log entry; got ${JSON.stringify(log.map((e: any) => e.textZh))}`,
  ).toBe(true)

  // ── 5. Doctrine read-through: aggressive closes, cautious holds. ───────
  // End this engagement, set distinct doctrines on the two escorts, clear
  // the DP commit (so both active escorts deploy), and re-enter combat.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.endCombatCheat('flee'),
  )
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.setShipAggression('escort-a', 'aggressive'),
  )
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.setShipAggression('escort-b', 'cautious'),
  )
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.startCombatCheat('pirateLight', [], null, {}),
  )

  const snap = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.combatPlayerSideSnapshot(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const escA = snap.find((r: any) => r.entityKey === 'escort-a')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const escB = snap.find((r: any) => r.entityKey === 'escort-b')
  expect(escA, 'escort-a should have deployed (DP commit cleared post-flee)').toBeTruthy()
  expect(escB, 'escort-b should have deployed (DP commit cleared post-flee)').toBeTruthy()

  // Doctrine reads through to the resolved standoff distance.
  const doctrineAgg = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.doctrineForAggression('aggressive'),
  )
  const doctrineCau = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.doctrineForAggression('cautious'),
  )
  expect(escA.aiMaintainRange, 'escort-a aggressive standoff = base × aggressive mul')
    .toBeCloseTo(220 * doctrineAgg.maintainRangeMul, 5)
  expect(escB.aiMaintainRange, 'escort-b cautious standoff = base × cautious mul')
    .toBeCloseTo(320 * doctrineCau.maintainRangeMul, 5)
  expect(
    escA.aiAggression > escB.aiAggression,
    'aggressive escort presses harder (higher weapon-charge multiplier)',
  ).toBe(true)

  // Flip-check: re-set escort-a to cautious and re-enter.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.endCombatCheat('flee'),
  )
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.setShipAggression('escort-a', 'cautious'),
  )
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.startCombatCheat('pirateLight', [], null, {}),
  )
  const snap2 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.combatPlayerSideSnapshot(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const escA2 = snap2.find((r: any) => r.entityKey === 'escort-a')
  expect(escA2, 'escort-a should re-deploy').toBeTruthy()
  expect(
    escA2.aiMaintainRange > escA.aiMaintainRange,
    `cautious standoff (${escA2.aiMaintainRange}) must widen vs aggressive (${escA.aiMaintainRange})`,
  ).toBe(true)

  // Clean up the open engagement so teardown sees a settled clock.
  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.endCombatCheat('flee'),
  )
})
