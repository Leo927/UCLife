// W2 command layer, Task 1 — fleet-order effects wired into the escort
// directive. issueFleetOrder() (fleetCommandPoints.ts) already debits CP;
// this smoke proves the standing order actually changes escort behavior:
//
//   1. Focus-fire on the non-nearest enemy overrides the escort's resolved
//      target (movement aim + §4b weapon-fire share the same resolution).
//   2. Rally steers the escort toward the ordered point while it keeps
//      aiming at its resolved hostile (rally overrides movement only).
//   3. Regroup clears both standing orders.
//
// Reuses the cp-dp fixture (flagship + 2 escorts, known player-skill CP/DP
// formula inputs — see tests/fixtures/cp-dp.json5) with only escort-a
// promoted active, so exactly one escort deploys alongside the flagship.

import { test, expect } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife__.setIsInActiveFleet',
  '__uclife__.startCombatCheat',
  '__uclife__.endCombatCheat',
  '__uclife__.tickCombatSystem',
  '__uclife__.useCombatStore',
  '__uclife__.commandPoolDescribe',
  '__uclife__.combatPlayerSideSnapshot',
  '__uclife__.issueFleetOrderDebug',
  '__uclife__.fleetOrdersDescribe',
]

const TICK_DT_MS = 500
// src/config/combat.json5 rallyArriveRadiusPx — an escort under a standing
// rally order resumes normal maintainRange movement once within this many
// arena units of the point.
const RALLY_ARRIVE_RADIUS_PX = 40
const RALLY_POINT = { x: 900, y: 550 }

test('fleet orders: focus-fire retargets, rally steers, regroup clears', async ({ sim }) => {
  await sim.boot({ fixture: 'cp-dp', requireHandles: REQUIRED_HANDLES })
  /* eslint-disable @typescript-eslint/no-explicit-any */

  // Only escort-a deploys — escort-b stays inactive at dock.
  await sim.page.evaluate(() => (window as any).__uclife__.setIsInActiveFleet('escort-a', true))

  // Two enemies: lead (enemy-ship-0) + one escort (enemy-ship-1).
  await sim.page.evaluate(() =>
    (window as any).__uclife__.startCombatCheat('pirateLight', ['pirateLight'], null, {}))

  const maxCp = (await sim.page.evaluate(() => (window as any).__uclife__.commandPoolDescribe())).max

  // Tactical opens paused (first-contact briefing) — unpause so tickCombatSystem
  // actually advances the directive + physics loop.
  await sim.page.evaluate(() => {
    const uu = (window as any).__uclife__
    if (uu.useCombatStore.getState().paused) uu.useCombatStore.getState().togglePause()
  })

  // ── 1. Focus-fire on the non-lead enemy overrides target selection. ────
  const focusOrder = await sim.page.evaluate(
    () => (window as any).__uclife__.issueFleetOrderDebug({ kind: 'focusFire', enemyKey: 'enemy-ship-1' }),
  )
  expect(focusOrder.ok, `focus-fire order should debit CP: ${JSON.stringify(focusOrder)}`).toBe(true)

  const poolAfterFocus = await sim.page.evaluate(() => (window as any).__uclife__.commandPoolDescribe())
  expect(poolAfterFocus.current, 'focus-fire debits 1 CP').toBe(maxCp - 1)

  await sim.page.evaluate((dt: number) => {
    const uu = (window as any).__uclife__
    for (let i = 0; i < 6; i++) uu.tickCombatSystem(dt)
  }, TICK_DT_MS)

  const snapAfterFocus = await sim.page.evaluate(
    () => (window as any).__uclife__.combatPlayerSideSnapshot(),
  )
  const escortAfterFocus = snapAfterFocus.find((r: any) => r.entityKey === 'escort-a')
  expect(escortAfterFocus, 'escort-a must have deployed').toBeTruthy()
  expect(
    escortAfterFocus.targetKey,
    `escort-a's resolved target must track the focus-fire order, not nearest-hostile: ${JSON.stringify(escortAfterFocus)}`,
  ).toBe('enemy-ship-1')

  // ── 2. Rally steers the escort toward the point while focus-fire holds. ─
  const rallyStart = escortAfterFocus.pos
  const startDist = Math.hypot(RALLY_POINT.x - rallyStart.x, RALLY_POINT.y - rallyStart.y)
  expect(startDist, 'rally point must start far enough away to observe convergence').toBeGreaterThan(200)

  const rallyOrder = await sim.page.evaluate(
    (point) => (window as any).__uclife__.issueFleetOrderDebug({ kind: 'rally', point }),
    RALLY_POINT,
  )
  expect(rallyOrder.ok, `rally order should debit CP: ${JSON.stringify(rallyOrder)}`).toBe(true)
  expect(
    (await sim.page.evaluate(() => (window as any).__uclife__.commandPoolDescribe())).current,
    'rally debits 1 more CP',
  ).toBe(maxCp - 2)

  // Deceleration means the escort can't stop exactly at the point — once
  // within rallyArriveRadiusPx, thrust reverts to normal maintainRange
  // combat maneuvering (§1), so it swings through and past rather than
  // parking. Sampling only the final tick would be a coin flip on where in
  // that oscillation it landed. The trajectory itself is fully
  // deterministic (no RNG in ship physics), so recording the minimum
  // distance seen across every tick of the drive is a stable, non-flaky
  // way to prove it actually reached the point at some tick.
  const rallyDrive = await sim.page.evaluate(
    (arg: { dt: number; ticks: number; point: { x: number; y: number } }) => {
      const uu = (window as any).__uclife__
      let minDist = Infinity
      let lastTargetKey = ''
      for (let i = 0; i < arg.ticks; i++) {
        uu.tickCombatSystem(arg.dt)
        const snap = uu.combatPlayerSideSnapshot()
        const escort = snap.find((r: any) => r.entityKey === 'escort-a')
        const d = Math.hypot(arg.point.x - escort.pos.x, arg.point.y - escort.pos.y)
        if (d < minDist) minDist = d
        lastTargetKey = escort.targetKey
      }
      return { minDist, lastTargetKey }
    },
    { dt: TICK_DT_MS, ticks: 40, point: RALLY_POINT },
  )
  expect(
    rallyDrive.minDist,
    `escort-a must come within rallyArriveRadiusPx of the rally point at some tick (min seen: ${rallyDrive.minDist.toFixed(1)})`,
  ).toBeLessThanOrEqual(RALLY_ARRIVE_RADIUS_PX)
  // Rally overrides movement only — the escort keeps aiming at its
  // focus-fire target throughout the transit.
  expect(rallyDrive.lastTargetKey, 'focus-fire aim must hold while rallying').toBe('enemy-ship-1')

  // ── 3. Regroup clears both standing orders. ─────────────────────────────
  // The 40-tick rally drive above spans 20 sim-seconds, long enough for
  // regenCommandPoints to refill whole points — so the pool right before
  // this order is no longer a fixed function of maxCp. Compare against the
  // freshly-read pre-order value instead of maxCp - N.
  const poolBeforeRegroup = await sim.page.evaluate(
    () => (window as any).__uclife__.commandPoolDescribe(),
  )
  const regroupOrder = await sim.page.evaluate(
    () => (window as any).__uclife__.issueFleetOrderDebug({ kind: 'regroup' }),
  )
  expect(regroupOrder.ok, `regroup order should debit CP: ${JSON.stringify(regroupOrder)}`).toBe(true)
  expect(
    (await sim.page.evaluate(() => (window as any).__uclife__.commandPoolDescribe())).current,
    'regroup debits 1 CP off whatever the pool held just before the order',
  ).toBe(poolBeforeRegroup.current - 1)

  const ordersAfterRegroup = await sim.page.evaluate(
    () => (window as any).__uclife__.fleetOrdersDescribe(),
  )
  expect(ordersAfterRegroup, 'regroup must clear both standing orders').toEqual({
    rallyPoint: null,
    focusTargetKey: null,
  })

  await sim.page.evaluate(() => (window as any).__uclife__.endCombatCheat('flee'))
})
