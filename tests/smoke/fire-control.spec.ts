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
//   4. Bridge-control review fix — the fire-mode gates are a bridge control
//      surface, not a fleet-wide one (Design/combat.md: the flagship is on
//      AI whenever the player isn't at the helm). While the player is
//      piloting the launched MS, mount 0's 'hold' selection must be
//      bypassed (the AI flagship fires every charged mount, pre-Task-5
//      shape) without mutating fireModeByMount; retaking the helm must
//      resume 'hold' exactly where the player left it. Mirrored in the UI:
//      the mode badge goes read-only (no onClick, aria-disabled) and the
//      row's volley click no-ops while piloting !== 'flagship', but the
//      queue itself stays visible.
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
  '__uclife__.launchPlayerMs',
  '__uclife__.dockPlayerMs',
  '__uclife__.takeFlagshipControl',
  '__uclife__.useCockpit',
]

// Task 5 review fix — launchPlayerMs needs an actual Ms entity to spawn
// (resolvePlayerMsEntity), which the cp-dp fixture (used by the tests above)
// doesn't carry. 'starter-fleet' does — see tests/fixtures/starter-fleet.json5
// and cockpit.spec.ts, whose board→helm→combat setup this mirrors.
const MS_REQUIRED_HANDLES = [
  ...REQUIRED_HANDLES,
  '__uclife_test__.step',
  '__uclife__.cheatMoney',
  '__uclife__.cheatPiloting',
  '__uclife__.boardShip',
  '__uclife__.takeHelmCheat',
  '__uclife__.listEnemies',
]

const STEP_BUDGET_MIN = 60

async function bootCombatOnStarterFleet(sim: {
  page: import('@playwright/test').Page
  stepUntil: (fn: () => boolean, maxMin: number) => Promise<void>
}): Promise<void> {
  const setupOk = await sim.page.evaluate(() => {
    const u = (window as any).__uclife__
    return u.cheatMoney(80000) && u.cheatPiloting(10)
  })
  expect(setupOk, 'cheatMoney+cheatPiloting failed at setup').toBeTruthy()

  await sim.page.evaluate(() => (window as any).__uclife__.boardShip())
  await sim.stepUntil(
    () => (window as any).__uclife__.useScene.getState().activeId === 'playerShipInterior',
    STEP_BUDGET_MIN,
  )

  const helmRes = await sim.page.evaluate(() => (window as any).__uclife__.takeHelmCheat())
  expect(helmRes?.ok, `takeHelmCheat should succeed; got ${JSON.stringify(helmRes)}`).toBeTruthy()

  const enemies = await sim.page.evaluate(() => (window as any).__uclife__.listEnemies())
  expect(enemies && enemies.length > 0, 'no enemies present in spaceCampaign').toBeTruthy()

  await sim.page.evaluate(
    (key: string) => (window as any).__uclife__.startCombatCheat('pirateLight', [], key),
    enemies[0].key,
  )
  await sim.stepUntil(
    () =>
      (window as any).__uclife__.useCombatStore.getState().open === true
      && (window as any).__uclife__.useCockpit.getState().piloting === 'flagship',
    STEP_BUDGET_MIN,
  )
  await sim.page.evaluate(() => {
    const uu = (window as any).__uclife__
    if (uu.useCombatStore.getState().paused) uu.useCombatStore.getState().togglePause()
  })
}

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

test('fire modes: bridge controls — AI flagship fires a held mount while piloting the MS, hold resumes on retaking the helm', async ({ sim }) => {
  await sim.boot({ fixture: 'starter-fleet', requireHandles: MS_REQUIRED_HANDLES })
  await bootCombatOnStarterFleet(sim)

  // Real bridge input: hold mount 0 while piloting the flagship (default
  // piloting state right after startCombat).
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.useCockpit.getState().piloting),
    'combat must start with the player piloting the flagship',
  ).toBe('flagship')
  await sim.page.evaluate(() => (window as any).__uclife__.useCombatStore.getState().cycleFireMode(0))
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.useCombatStore.getState().fireModeByMount[0]),
    'one cycleFireMode call must move mount 0 from auto to hold',
  ).toBe('hold')

  // Launch the MS — the flagship's helm goes to AI (piloting: 'flagship' -> 'ms').
  const launchRes = await sim.page.evaluate(() => (window as any).__uclife__.launchPlayerMs())
  expect(launchRes?.ok, `launchPlayerMs should succeed; got ${JSON.stringify(launchRes)}`).toBe(true)
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.useCockpit.getState().piloting),
    'piloting must switch to ms after launch',
  ).toBe('ms')

  // Drive combat long enough for the AI-controlled flagship to close from
  // spawn separation into weapon range and cycle several charges — same
  // geometry/timing as the sibling 'hold blocks fire' test above.
  await sim.page.evaluate((dt: number) => {
    const uu = (window as any).__uclife__
    for (let i = 0; i < 50; i++) uu.tickCombatSystem(dt)
  }, TICK_DT_MS)
  const countsUnderAi: ShotCounts = await sim.page.evaluate(() => (window as any).__uclife__.playerMountShotCounts())
  expect(
    shotsFor(countsUnderAi, 0),
    'an AI-controlled flagship fires all its charged mounts — fire-mode gates are bridge controls, bypassed while the player is not piloting the flagship',
  ).toBeGreaterThan(0)
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.useCombatStore.getState().fireModeByMount[0]),
    'fireModeByMount must not be mutated by the AI bypass — the player\'s selection persists',
  ).toBe('hold')

  // Dock back and retake the helm.
  const dockRes = await sim.page.evaluate(() => (window as any).__uclife__.dockPlayerMs(true))
  expect(dockRes?.ok, `dockPlayerMs should succeed; got ${JSON.stringify(dockRes)}`).toBe(true)
  const helmRes = await sim.page.evaluate(() => (window as any).__uclife__.takeFlagshipControl())
  expect(helmRes?.ok, `takeFlagshipControl should succeed; got ${JSON.stringify(helmRes)}`).toBe(true)
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.useCockpit.getState().piloting),
    'piloting must be back to flagship after retaking the helm',
  ).toBe('flagship')

  // Hold resumes the instant the player is back at the helm: further ticks
  // (even fully charged, in range) must not add any more shots on mount 0.
  const countsAfterRehelm: ShotCounts = await sim.page.evaluate(() => (window as any).__uclife__.playerMountShotCounts())
  await sim.page.evaluate((dt: number) => {
    const uu = (window as any).__uclife__
    for (let i = 0; i < 10; i++) uu.tickCombatSystem(dt)
  }, TICK_DT_MS)
  const countsAfterIdle: ShotCounts = await sim.page.evaluate(() => (window as any).__uclife__.playerMountShotCounts())
  expect(
    shotsFor(countsAfterIdle, 0),
    'hold must resume the instant the player retakes the helm — no further shots on mount 0',
  ).toBe(shotsFor(countsAfterRehelm, 0))
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.useCombatStore.getState().fireModeByMount[0]),
    'mount 0\'s stored mode must still read hold after retaking the helm',
  ).toBe('hold')

  await sim.page.evaluate(() => (window as any).__uclife__.endCombatCheat('flee'))
})

test('fire modes (real input): mode badge goes read-only while piloting the MS, queue stays visible', async ({ sim }) => {
  await sim.boot({ fixture: 'starter-fleet', requireHandles: MS_REQUIRED_HANDLES })
  await bootCombatOnStarterFleet(sim)
  // Second flagship hardpoint ships empty by default content (see the file
  // header comment) — arm it so the row-click no-op assertion below has a
  // real row to click.
  await sim.page.evaluate(() => (window as any).__uclife__.armWeaponMountForTest(1, 'beamMk1'))
  await sim.page.waitForSelector('.tactical-overlay', { timeout: DOM_COMMIT_TIMEOUT_MS })
  await sim.page.waitForSelector('.tactical-canvas-host canvas', { timeout: DOM_COMMIT_TIMEOUT_MS })

  // Cycle mount 0 to hold while at the helm — a real click, same as the
  // sibling real-input test above.
  const modeBadge = sim.page.locator('[data-tactical-weapon-mode="0"]')
  await modeBadge.click()
  await expect(modeBadge, 'one badge click cycles auto -> hold while at the helm').toHaveText('待命')

  // Launch the MS — piloting leaves the flagship. launchMs() is synchronous
  // (spawns the MS entity + flips the cockpit store directly, no async
  // scene transition to wait on), so the piloting flip is visible the
  // instant the evaluate() call resolves.
  const launchRes = await sim.page.evaluate(() => (window as any).__uclife__.launchPlayerMs())
  expect(launchRes?.ok, `launchPlayerMs should succeed; got ${JSON.stringify(launchRes)}`).toBe(true)
  expect(
    await sim.page.evaluate(() => (window as any).__uclife__.useCockpit.getState().piloting),
    'piloting must switch to ms after launch',
  ).toBe('ms')

  // The queue stays visible (situational awareness) and still reports the
  // stored mode, but the badge is now read-only.
  await expect(modeBadge, 'the mode badge must stay visible while piloting the MS').toBeVisible()
  await expect(modeBadge, 'the badge keeps reporting the stored mode while read-only').toHaveText('待命')
  await expect(modeBadge, 'a read-only badge is aria-disabled').toHaveAttribute('aria-disabled', 'true')
  // aria-disabled already makes Playwright refuse a normal click (the
  // element fails the "enabled" actionability check) — force it through to
  // prove the underlying onClick handler itself is gone, not just that the
  // browser's default actionability gate happens to block it.
  await modeBadge.click({ force: true })
  await expect(
    modeBadge,
    'clicking the badge while piloting the MS must not cycle the mode — it is a bridge control',
  ).toHaveText('待命')

  // The row body's volley click must also no-op while piloting the MS.
  await sim.page.evaluate(() => {
    const uu = (window as any).__uclife__
    uu.useCombatStore.getState().cycleFireMode(1)   // auto -> hold (mount 1 was left on auto by bootCombatWithTwoEnemies)
    uu.useCombatStore.getState().cycleFireMode(1)   // hold -> volley
  })
  const weaponRow = sim.page.locator('[data-tactical-weapon-row="1"]')
  await weaponRow.click()
  const counts: ShotCounts = await sim.page.evaluate(() => (window as any).__uclife__.playerMountShotCounts())
  expect(shotsFor(counts, 1), 'a row click while piloting the MS must not queue a volley request').toBe(0)

  await sim.page.evaluate(() => (window as any).__uclife__.endCombatCheat('flee'))
})
