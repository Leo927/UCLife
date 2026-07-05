// W2 command layer, Task 5 — per-mount manual fire control (auto / hold /
// volley). Pre-Task-5, every WeaponMount auto-fired the instant it charged;
// this smoke proves the player now has trigger discipline:
//
//   1. 'hold' on one mount accumulates charge but never fires, while a
//      sibling mount left on 'auto' keeps firing normally — the modes are
//      independent per WeaponMount.mountIdx.
//   2. 'volley' also withholds auto-fire; a ready volley mount fires exactly
//      once per player-issued request (single-shot semantics), and targets
//      the in-arc enemy nearest the aim cursor rather than nearest-to-
//      flagship (which 'auto' uses) — proven by aiming at the farther of
//      two enemies and confirming the shot lands on it, not the nearer one.
//   3. Real-input UI: the mode badge (data-tactical-weapon-mode) cycles
//      自动→待命→齐射→自动 on click, and the row body
//      (data-tactical-weapon-row) fires a queued volley shot on click only
//      once armed + ready.
//
// All ship classes currently author only one `defaultWeapons` entry even
// when they declare 2+ mounts (see src/data/ship-classes.json5), so the
// flagship's second hardpoint spawns empty. `armWeaponMountForTest` (a
// test-only debug verb, src/boot/debugHandles/combat.ts) arms it without
// touching ship-class content/balance.

import { test, expect, DOM_COMMIT_TIMEOUT_MS } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife__.startCombatCheat',
  '__uclife__.endCombatCheat',
  '__uclife__.tickCombatSystem',
  '__uclife__.useCombatStore',
  '__uclife__.armWeaponMountForTest',
  '__uclife__.playerMountShotCounts',
  '__uclife__.combatEnemySnapshot',
  '__uclife__.combatPlayerSideSnapshot',
]

const TICK_DT_MS = 500
// beamMk1 (src/data/weapons.json5): chargeSec 1.2, range 220. lightFreighter
// (the cp-dp fixture's flagship) closes from the standard 500-unit spawn
// separation toward its ai.maintainRange (~200) with no WASD input — see
// fleet-orders.spec.ts's header comment for the same geometry.
const WEAPON_RANGE_PX = 220

type ShotCounts = { mountIdx: number; count: number; lastTargetKey: string }[]

function shotsFor(counts: ShotCounts, mountIdx: number): number {
  return counts.find((c) => c.mountIdx === mountIdx)?.count ?? 0
}

async function bootCombatWithTwoEnemies(sim: { page: import('@playwright/test').Page }): Promise<void> {
  await sim.page.evaluate(() =>
    (window as any).__uclife__.startCombatCheat('pirateLight', ['pirateLight'], null, {}))
  // Second flagship hardpoint ships empty by default content — arm it with
  // the same weapon as mount 0 so both mounts are live for the test.
  await sim.page.evaluate(() => (window as any).__uclife__.armWeaponMountForTest(1, 'beamMk1'))
  await sim.page.evaluate(() => {
    const uu = (window as any).__uclife__
    if (uu.useCombatStore.getState().paused) uu.useCombatStore.getState().togglePause()
  })
}

test('fire modes: hold blocks a mount\'s fire while a sibling mount on auto keeps firing', async ({ sim }) => {
  await sim.boot({ fixture: 'cp-dp', requireHandles: REQUIRED_HANDLES })
  await bootCombatWithTwoEnemies(sim)

  await sim.page.evaluate(() => (window as any).__uclife__.useCombatStore.getState().cycleFireMode(0))
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.useCombatStore.getState().fireModeByMount[0]),
    'one cycleFireMode call must move mount 0 from auto to hold',
  ).toBe('hold')

  // Drive combat long enough for the flagship's own directive (§1) to close
  // from spawn separation into weapon range with no WASD input, and for
  // several 1.2s charge cycles to elapse once there.
  await sim.page.evaluate((dt: number) => {
    const uu = (window as any).__uclife__
    for (let i = 0; i < 50; i++) uu.tickCombatSystem(dt)
  }, TICK_DT_MS)

  const counts: ShotCounts = await sim.page.evaluate(() => (window as any).__uclife__.playerMountShotCounts())
  expect(shotsFor(counts, 0), 'mount 0 (hold) must never fire, even fully charged and in range').toBe(0)
  expect(shotsFor(counts, 1), 'mount 1 (auto) must have fired at least once over 25 sim-seconds').toBeGreaterThan(0)

  await sim.page.evaluate(() => (window as any).__uclife__.endCombatCheat('flee'))
})

test('fire modes: volley fires exactly one ready shot on request, aimed at the enemy nearest the aim cursor', async ({ sim }) => {
  await sim.boot({ fixture: 'cp-dp', requireHandles: REQUIRED_HANDLES })
  await bootCombatWithTwoEnemies(sim)

  // Mount 0 stays on hold for this test purely to stop it from possibly
  // destroying enemy-ship-0 before the range-closing loop below finishes
  // (mount 0's own auto-fire is already covered by the previous test).
  // Mount 1 goes to volley with a full-circle arc override — without the
  // override, the flagship's narrow 30° default arc could exclude
  // enemy-ship-1 once the ship is heading toward the nearer enemy-ship-0,
  // which would make "aim at the farther enemy" untestable rather than
  // false.
  await sim.page.evaluate(() => (window as any).__uclife__.useCombatStore.getState().cycleFireMode(0))
  await sim.page.evaluate(() =>
    (window as any).__uclife__.armWeaponMountForTest(1, 'beamMk1', Math.PI * 2))
  await sim.page.evaluate(() => {
    const uu = (window as any).__uclife__
    uu.useCombatStore.getState().cycleFireMode(1)   // auto -> hold
    uu.useCombatStore.getState().cycleFireMode(1)   // hold -> volley
  })

  // Drive combat, tick by tick, until both enemies are within weapon range —
  // fully deterministic (no RNG in ship physics), bounded by a tick cap so a
  // regression that stops the ships from closing fails loud instead of
  // hanging.
  const closeDrive = await sim.page.evaluate(
    (arg: { dt: number; range: number }) => {
      const uu = (window as any).__uclife__
      for (let i = 0; i < 100; i++) {
        uu.tickCombatSystem(arg.dt)
        const player = uu.combatPlayerSideSnapshot().find((r: any) => r.isFlagship)
        const enemies = uu.combatEnemySnapshot()
        const e0 = enemies.find((e: any) => e.key === 'enemy-ship-0')
        const e1 = enemies.find((e: any) => e.key === 'enemy-ship-1')
        if (!e0 || !e1) continue
        const d0 = Math.hypot(e0.pos.x - player.pos.x, e0.pos.y - player.pos.y)
        const d1 = Math.hypot(e1.pos.x - player.pos.x, e1.pos.y - player.pos.y)
        if (d0 <= arg.range && d1 <= arg.range) {
          return { reached: true, ticks: i, d0, d1, e1Pos: e1.pos }
        }
      }
      return { reached: false, ticks: -1, d0: -1, d1: -1, e1Pos: null }
    },
    { dt: TICK_DT_MS, range: WEAPON_RANGE_PX },
  )
  expect(
    closeDrive.reached,
    `both enemies must come within weapon range for a deterministic aim-target test: ${JSON.stringify(closeDrive)}`,
  ).toBe(true)
  expect(
    closeDrive.d0,
    'enemy-ship-0 (lead, spawns dead ahead) must be the nearer enemy so aiming at enemy-ship-1 actually overrides nearest-to-flagship',
  ).toBeLessThan(closeDrive.d1)

  // Volley mount must still be charged-and-ready but unfired — it has been
  // charging the whole close-in drive with no request queued.
  const countsBeforeRequest: ShotCounts = await sim.page.evaluate(
    () => (window as any).__uclife__.playerMountShotCounts(),
  )
  expect(shotsFor(countsBeforeRequest, 1), 'a ready volley mount must not fire before a request is queued').toBe(0)

  // Aim at the farther enemy (enemy-ship-1) and fire the single-shot request.
  await sim.page.evaluate(
    (pos) => (window as any).__uclife__.useCombatStore.getState().setAimMouse(pos),
    closeDrive.e1Pos,
  )
  await sim.page.evaluate(() => (window as any).__uclife__.useCombatStore.getState().requestVolleyFire(1))
  await sim.page.evaluate((dt: number) => (window as any).__uclife__.tickCombatSystem(dt), TICK_DT_MS)

  const countsAfterOneShot: ShotCounts = await sim.page.evaluate(
    () => (window as any).__uclife__.playerMountShotCounts(),
  )
  expect(shotsFor(countsAfterOneShot, 1), 'the queued volley request must fire exactly one shot').toBe(1)
  expect(
    countsAfterOneShot.find((c) => c.mountIdx === 1)?.lastTargetKey,
    'the volley shot must target the enemy nearest the aim cursor (enemy-ship-1), not nearest-to-flagship (enemy-ship-0)',
  ).toBe('enemy-ship-1')
  expect(shotsFor(countsAfterOneShot, 0), 'mount 0 (hold) must still never fire').toBe(0)

  // No standing request remains — further ticks must not auto-refire the
  // volley mount even once it recharges back to ready.
  await sim.page.evaluate((dt: number) => {
    const uu = (window as any).__uclife__
    for (let i = 0; i < 10; i++) uu.tickCombatSystem(dt)
  }, TICK_DT_MS)
  const countsAfterIdle: ShotCounts = await sim.page.evaluate(
    () => (window as any).__uclife__.playerMountShotCounts(),
  )
  expect(
    shotsFor(countsAfterIdle, 1),
    'a volley mount must not auto-refire once recharged without a fresh request',
  ).toBe(1)

  await sim.page.evaluate(() => (window as any).__uclife__.endCombatCheat('flee'))
})

test('fire modes (real input): mode badge cycles 自动→待命→齐射, row click fires a queued volley shot', async ({ sim }) => {
  await sim.boot({ fixture: 'cp-dp', requireHandles: REQUIRED_HANDLES })
  await bootCombatWithTwoEnemies(sim)
  await sim.page.waitForSelector('.tactical-overlay', { timeout: DOM_COMMIT_TIMEOUT_MS })
  await sim.page.waitForSelector('.tactical-canvas-host canvas', { timeout: DOM_COMMIT_TIMEOUT_MS })

  const modeBadge = sim.page.locator('[data-tactical-weapon-mode="1"]')
  await expect(modeBadge, 'mount 1 starts on auto').toHaveText('自动')
  await modeBadge.click()
  await expect(modeBadge, 'one badge click cycles auto -> hold').toHaveText('待命')
  await modeBadge.click()
  await expect(modeBadge, 'a second badge click cycles hold -> volley').toHaveText('齐射')
  await modeBadge.click()
  await expect(modeBadge, 'a third badge click cycles volley back to auto').toHaveText('自动')

  // Cycle back to volley and hold mount 0 so it can't confound the shot count.
  await modeBadge.click()   // auto -> hold
  await modeBadge.click()   // hold -> volley
  await sim.page.evaluate(() => (window as any).__uclife__.useCombatStore.getState().cycleFireMode(0))

  // Charge the mount via debug ticks (system-smoke, not a journey spec — real
  // player input drives the mode + fire click below; ticks only advance sim
  // time, the same substrate role stepFor plays elsewhere).
  await sim.page.evaluate((dt: number) => {
    const uu = (window as any).__uclife__
    for (let i = 0; i < 5; i++) uu.tickCombatSystem(dt)
  }, TICK_DT_MS)
  expect(
    (await sim.page.evaluate(() => (window as any).__uclife__.useCombatStore.getState().fireModeByMount[1])),
    'mount 1 must still be armed to volley going into the row click',
  ).toBe('volley')

  // The row's onClick closure captures `ready` from the last React render;
  // the debug ticks above mutate ECS state directly (no React notification),
  // so wait for the DOM to actually repaint as ready before clicking —
  // otherwise the click could race a stale pre-charge render. This polls
  // rendered DOM content (sanctioned), not sim state.
  const weaponRow = sim.page.locator('[data-tactical-weapon-row="1"]')
  await expect(weaponRow, 'mount 1 must render as ready before the fire click').toHaveClass(/is-volley-ready/)
  await weaponRow.click()
  await sim.page.evaluate((dt: number) => (window as any).__uclife__.tickCombatSystem(dt), TICK_DT_MS)

  const counts: ShotCounts = await sim.page.evaluate(() => (window as any).__uclife__.playerMountShotCounts())
  expect(shotsFor(counts, 1), 'the real row click must queue a volley request that fires exactly one shot').toBe(1)

  await sim.page.evaluate(() => (window as any).__uclife__.endCombatCheat('flee'))
})
