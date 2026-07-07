// W2 command layer. issueFleetOrder() (fleetCommandPoints.ts) already
// debits CP; this smoke proves the standing order actually changes escort
// behavior:
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
//
// Task 2 extends this with the REAL-INPUT order palette: DOM button clicks
// + `page.mouse.click` on the tactical arena canvas, resolved through
// TacticalView's click-target mode instead of the `issueFleetOrderDebug`
// debug verb Task 1 used for the backend-only cases above.

import { test, expect, DOM_COMMIT_TIMEOUT_MS, CANVAS_MOUNT_TIMEOUT_MS } from './_fixtures'

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
  '__uclife__.getTacticalEnemyScreenCoords',
  '__uclife__.getTacticalWorldScreenCoords',
  '__uclife__.pushCombatLogDebug',
]

const TICK_DT_MS = 500
// src/config/combat.json5 rallyArriveRadiusPx — an escort under a standing
// rally order resumes normal maintainRange movement once within this many
// arena units of the point.
const RALLY_ARRIVE_RADIUS_PX = 40
const RALLY_POINT = { x: 900, y: 550 }
// Far from both spawn clusters (player/escort near (250,300), enemies near
// (750,300) — see src/systems/combat.ts's PLAYER_SPAWN / ENEMY_FORMATION_CENTER)
// and well outside combatConfig.orderPickRadiusPx (60) of anything, so a
// focus-fire click here always resolves to "no target."
const EMPTY_ARENA_POINT = { x: 20, y: 20 }
// Screen→world→screen round-tripping through a real browser mouse click
// (integer CSS-pixel coords) can lose a fraction of an arena unit to
// rounding at the tactical arena's letterbox scale. A few units of
// tolerance absorbs that without masking a real projection bug.
const RALLY_CLICK_TOLERANCE_PX = 3

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

// ── Task 2 — real-input order palette ─────────────────────────────────────

async function bootTacticalWithEscort(sim: { page: import('@playwright/test').Page }): Promise<void> {
  await sim.page.evaluate(() => (window as any).__uclife__.setIsInActiveFleet('escort-a', true))
  await sim.page.evaluate(() =>
    (window as any).__uclife__.startCombatCheat('pirateLight', ['pirateLight'], null, {}))
  await sim.page.waitForSelector('.tactical-overlay', { timeout: DOM_COMMIT_TIMEOUT_MS })
  // PixiCanvas's Application.init() is async — the arena <canvas> the
  // world→screen helpers project through doesn't exist the instant
  // .tactical-overlay mounts.
  await sim.page.waitForSelector('.tactical-canvas-host canvas', { timeout: CANVAS_MOUNT_TIMEOUT_MS })
}

test('order palette (real input): CP gauge, order costs, withdraw enabled and CP-free', async ({ sim }) => {
  await sim.boot({ fixture: 'cp-dp', requireHandles: REQUIRED_HANDLES })
  await bootTacticalWithEscort(sim)

  const cp = await sim.page.evaluate(() => (window as any).__uclife__.commandPoolDescribe())
  const gauge = sim.page.locator('[data-tactical-cp]')
  await expect(gauge, 'CP gauge attribute mirrors commandPoolDescribe()').toHaveAttribute(
    'data-tactical-cp', `${cp.current}/${cp.max}`,
  )
  await expect(gauge, 'CP gauge text shows current/max').toContainText(`${cp.current}/${cp.max}`)

  await expect(
    sim.page.locator('[data-tactical-order="rally"]'), '集结 button shows its CP cost',
  ).toContainText('1 CP')
  await expect(
    sim.page.locator('[data-tactical-order="focusFire"]'), '集火 button shows its CP cost',
  ).toContainText('1 CP')
  await expect(
    sim.page.locator('[data-tactical-order="regroup"]'), '重整队形 button shows its CP cost',
  ).toContainText('1 CP')

  // W2 Task 3 — withdraw is always available and CP-free (locked decision):
  // no orderCosts row, no disabled state, no tooltip. Full withdraw
  // coverage (real click confirm, penalty, no re-prompt) lives in
  // combat-withdraw.spec.ts.
  const withdraw = sim.page.locator('[data-tactical-order="withdraw"]')
  await expect(withdraw, 'withdraw is enabled — no CP gating').toBeEnabled()
  await expect(withdraw, 'withdraw shows no CP cost suffix').toHaveText('撤退')

  await sim.page.evaluate(() => (window as any).__uclife__.endCombatCheat('flee'))
})

test('order palette (real input): click-target rally + focus-fire, Esc/empty-click cancel, works while paused', async ({ sim }) => {
  await sim.boot({ fixture: 'cp-dp', requireHandles: REQUIRED_HANDLES })
  await bootTacticalWithEscort(sim)

  const maxCp = (await sim.page.evaluate(() => (window as any).__uclife__.commandPoolDescribe())).max

  // Tactical opens paused on first contact — the palette must accept orders
  // right here, before the player ever unpauses.
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.useCombatStore.getState().paused),
    'tactical view opens paused on first contact',
  ).toBe(true)

  // ── Esc cancels a pending order — no CP spent, armed state reverts ────
  const rallyBtn = sim.page.locator('[data-tactical-order="rally"]')
  await rallyBtn.click()
  await expect(rallyBtn, 'rally button enters armed (pending) state').toHaveClass(/is-pending/)
  await sim.page.keyboard.press('Escape')
  await expect(rallyBtn, 'Esc disarms the rally button back to idle').not.toHaveClass(/is-pending/)
  expect(
    (await sim.page.evaluate(() => (window as any).__uclife__.commandPoolDescribe())).current,
    'Esc-cancel must not spend CP',
  ).toBe(maxCp)

  // ── Right-click cancels too ───────────────────────────────────────────
  const focusFireBtn = sim.page.locator('[data-tactical-order="focusFire"]')
  await focusFireBtn.click()
  await expect(focusFireBtn, 'focus-fire button enters armed (pending) state').toHaveClass(/is-pending/)
  await sim.page.mouse.click(EMPTY_ARENA_POINT.x + 400, EMPTY_ARENA_POINT.y + 300, { button: 'right' })
  await expect(focusFireBtn, 'right-click disarms the focus-fire button back to idle').not.toHaveClass(/is-pending/)
  expect(
    (await sim.page.evaluate(() => (window as any).__uclife__.commandPoolDescribe())).current,
    'right-click cancel must not spend CP',
  ).toBe(maxCp)

  // ── An empty-arena left-click cancels focus-fire with a toast, no CP spent ──
  await sim.page.locator('[data-tactical-order="focusFire"]').click()
  const emptyPt = await sim.page.evaluate(
    (p) => (window as any).__uclife__.getTacticalWorldScreenCoords(p), EMPTY_ARENA_POINT,
  )
  expect(emptyPt, 'the empty arena point must project onto the tactical canvas').toBeTruthy()
  await sim.page.mouse.click(emptyPt.x, emptyPt.y)
  await expect(sim.page.locator('.toast'), 'no-target click toasts a cancellation').toContainText('未发现目标')
  expect(
    (await sim.page.evaluate(() => (window as any).__uclife__.commandPoolDescribe())).current,
    'no-target cancel must not spend CP',
  ).toBe(maxCp)

  // ── Focus-fire real click while PAUSED writes the standing order ──────
  await sim.page.locator('[data-tactical-order="focusFire"]').click()
  const enemyPt = await sim.page.evaluate(
    () => (window as any).__uclife__.getTacticalEnemyScreenCoords('enemy-ship-1'),
  )
  expect(enemyPt, 'enemy-ship-1 must project onto the tactical arena').toBeTruthy()
  await sim.page.mouse.click(enemyPt.x, enemyPt.y)

  expect(
    (await sim.page.evaluate(() => (window as any).__uclife__.commandPoolDescribe())).current,
    'focus-fire debits CP even while paused — pause is the planning moment',
  ).toBe(maxCp - 1)
  expect(
    (await sim.page.evaluate(() => (window as any).__uclife__.fleetOrdersDescribe())).focusTargetKey,
    'the order writes fleet-order state while paused',
  ).toBe('enemy-ship-1')

  // ── Unpause via real DOM click; the paused-issued order actually applies ──
  await sim.page.locator('.tactical-topbar').getByRole('button', { name: /继续/ }).click()
  await sim.page.evaluate((dt: number) => {
    const uu = (window as any).__uclife__
    for (let i = 0; i < 6; i++) uu.tickCombatSystem(dt)
  }, TICK_DT_MS)
  const snap = await sim.page.evaluate(() => (window as any).__uclife__.combatPlayerSideSnapshot())
  const escort = snap.find((r: { entityKey: string }) => r.entityKey === 'escort-a')
  expect(escort, 'escort-a must have deployed').toBeTruthy()
  expect(
    escort.targetKey,
    'escort-a tracks the paused-issued focus-fire order once unpaused',
  ).toBe('enemy-ship-1')

  // ── Rally via real DOM button + arena click ───────────────────────────
  const cpBeforeRally = (await sim.page.evaluate(() => (window as any).__uclife__.commandPoolDescribe())).current
  await sim.page.locator('[data-tactical-order="rally"]').click()
  const rallyPt = await sim.page.evaluate(
    (p) => (window as any).__uclife__.getTacticalWorldScreenCoords(p), RALLY_POINT,
  )
  expect(rallyPt, 'the rally point must project onto the tactical canvas').toBeTruthy()
  await sim.page.mouse.click(rallyPt.x, rallyPt.y)

  const ordersAfterRally = await sim.page.evaluate(() => (window as any).__uclife__.fleetOrdersDescribe())
  expect(
    ordersAfterRally.rallyPoint?.x,
    `real-click rally point x must match the clicked world point within tolerance: ${JSON.stringify(ordersAfterRally.rallyPoint)}`,
  ).toBeGreaterThanOrEqual(RALLY_POINT.x - RALLY_CLICK_TOLERANCE_PX)
  expect(ordersAfterRally.rallyPoint?.x).toBeLessThanOrEqual(RALLY_POINT.x + RALLY_CLICK_TOLERANCE_PX)
  expect(ordersAfterRally.rallyPoint?.y).toBeGreaterThanOrEqual(RALLY_POINT.y - RALLY_CLICK_TOLERANCE_PX)
  expect(ordersAfterRally.rallyPoint?.y).toBeLessThanOrEqual(RALLY_POINT.y + RALLY_CLICK_TOLERANCE_PX)
  expect(
    (await sim.page.evaluate(() => (window as any).__uclife__.commandPoolDescribe())).current,
    'rally debits 1 more CP',
  ).toBe(cpBeforeRally - 1)

  // ── Regroup via real DOM button clears both standing orders ──────────
  const cpBeforeRegroup = (await sim.page.evaluate(() => (window as any).__uclife__.commandPoolDescribe())).current
  await sim.page.locator('[data-tactical-order="regroup"]').click()
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.fleetOrdersDescribe()),
    'regroup must clear both standing orders',
  ).toEqual({ rallyPoint: null, focusTargetKey: null })
  expect(
    (await sim.page.evaluate(() => (window as any).__uclife__.commandPoolDescribe())).current,
    'regroup debits 1 CP',
  ).toBe(cpBeforeRegroup - 1)

  await sim.page.evaluate(() => (window as any).__uclife__.endCombatCheat('flee'))
})

// ── Task 7 — combat log must not cover the player status readout ─────────
// A pre-W1 playtest observed `.combat-log` (top-left fading scroll)
// rendering on top of `.tactical-hud-player`, hiding hull/armor mid-fight.
// Regression guard: with the log full of entries, its bounding box must not
// intersect the player HUD's, at any viewport the game actually ships at.
function boxesIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return !(
    a.x + a.width <= b.x
    || b.x + b.width <= a.x
    || a.y + a.height <= b.y
    || b.y + b.height <= a.y
  )
}

async function assertCombatLogClearsPlayerHud(sim: { page: import('@playwright/test').Page }): Promise<void> {
  // 6+ log lines, per the brief — enough to fill the log's visible window
  // and stress its max-height, not just a single-line sliver.
  await sim.page.evaluate(() => {
    const uu = (window as any).__uclife__
    for (let i = 0; i < 8; i++) uu.pushCombatLogDebug(`测试日志 · 第 ${i} 行`, 'info')
  })

  const logBox = await sim.page.locator('.combat-log').boundingBox()
  const hudBox = await sim.page.locator('.tactical-hud-player').boundingBox()
  expect(logBox, '.combat-log must be visible once entries are pushed').toBeTruthy()
  expect(hudBox, '.tactical-hud-player must be visible').toBeTruthy()

  expect(
    boxesIntersect(logBox!, hudBox!),
    `combat log must not cover the player status readout (hull/armor): log=${JSON.stringify(logBox)} hud=${JSON.stringify(hudBox)}`,
  ).toBe(false)
}

test('combat log does not cover the player status readout (default viewport)', async ({ sim }) => {
  await sim.boot({ fixture: 'cp-dp', requireHandles: REQUIRED_HANDLES })
  await bootTacticalWithEscort(sim)

  await assertCombatLogClearsPlayerHud(sim)

  await sim.page.evaluate(() => (window as any).__uclife__.endCombatCheat('flee'))
})

test('combat log does not cover the player status readout (playtest-realistic small viewport)', async ({ sim }) => {
  // The original playtest report predates W2's topbar changes and didn't
  // record its viewport; 1024x600 is a realistic small-laptop size well
  // below the default 1280x800 Playwright viewport, used here to check the
  // overlap isn't merely hidden by extra vertical room.
  await sim.page.setViewportSize({ width: 1024, height: 600 })
  await sim.boot({ fixture: 'cp-dp', requireHandles: REQUIRED_HANDLES })
  await bootTacticalWithEscort(sim)

  await assertCombatLogClearsPlayerHud(sim)

  await sim.page.evaluate(() => (window as any).__uclife__.endCombatCheat('flee'))
})

test('order palette (real input): insufficient CP refuses the order and leaves fleet-order state untouched', async ({ sim }) => {
  await sim.boot({ fixture: 'cp-dp', requireHandles: REQUIRED_HANDLES })
  await bootTacticalWithEscort(sim)

  // Drain the pool via repeated real regroup clicks (formationChange costs 1
  // CP; regroup is a one-shot order, no arm/resolve needed). No
  // tickCombatSystem call happens between clicks, so regenCommandPoints
  // never runs — the pool only ever goes down, making the drain
  // deterministic regardless of wall-clock time spent clicking.
  const regroupBtn = sim.page.locator('[data-tactical-order="regroup"]')
  const maxCp = (await sim.page.evaluate(() => (window as any).__uclife__.commandPoolDescribe())).max
  let cpAfterDrain = { current: -1, max: maxCp }
  for (let i = 0; i < maxCp; i++) {
    await regroupBtn.click()
    cpAfterDrain = await sim.page.evaluate(() => (window as any).__uclife__.commandPoolDescribe())
  }
  expect(cpAfterDrain.current, 'repeated regroup clicks must drain the CP pool to exactly 0').toBe(0)

  const ordersBeforeRefusal = await sim.page.evaluate(() => (window as any).__uclife__.fleetOrdersDescribe())

  // ── Arm + resolve a rally order against the empty pool: refused ──────
  await sim.page.locator('[data-tactical-order="rally"]').click()
  const rallyPt = await sim.page.evaluate(
    (p) => (window as any).__uclife__.getTacticalWorldScreenCoords(p), RALLY_POINT,
  )
  expect(rallyPt, 'the rally point must project onto the tactical canvas').toBeTruthy()
  await sim.page.mouse.click(rallyPt.x, rallyPt.y)

  await expect(
    sim.page.locator('.toast'),
    'an insufficient-CP refusal toasts the CP-exhausted reason',
  ).toContainText('指挥点不足')
  expect(
    (await sim.page.evaluate(() => (window as any).__uclife__.commandPoolDescribe())).current,
    'a refused order must not push CP below 0',
  ).toBe(0)
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.fleetOrdersDescribe()),
    'a refused order must leave standing fleet-order state exactly as it was before the attempt',
  ).toEqual(ordersBeforeRefusal)

  await sim.page.evaluate(() => (window as any).__uclife__.endCombatCheat('flee'))
})
