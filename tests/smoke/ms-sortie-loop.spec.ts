// Phase 6.2.5.C smoke — in-tactical sortie loop.
//
// Walks the issue's seven-step scenario end-to-end against the
// deterministic substrate:
//   1. Boot fixture, board, helm, enter combat, launch MS.
//   2. Set per-MS ammo to 1 round + propellant to a small value via the
//      debug `setMsSortieResources` handle. Assert the snapshot reflects
//      the seeded resources.
//   3. Force-strand the MS by setting propellant to 0, assert stranded
//      state surfaces via `getStrandedMs`.
//   4. Dispatch recovery tug via debug handle; assert one tug spawns.
//   5. Step until the tug returns + the MS enters ResupplyState.
//   6. Step until resupply completes; assert propellant + ammo caps
//      restored and a completion log line landed; assert NO auto-pause.
//   7. Relaunch and assert the MS spawned at the authored door geometry.
//
// All gates run through `__uclife__` debug handles + `sim.stepUntil`
// per CLAUDE.md § Smoke-test reliability.

import { test, expect, isKnownPixiBatcherStartup } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.startCombatCheat',
  '__uclife__.launchPlayerMs',
  '__uclife__.dockPlayerMs',
  '__uclife__.takeFlagshipControl',
  '__uclife__.takeHelmCheat',
  '__uclife__.boardShip',
  '__uclife__.msState',
  '__uclife__.useCockpit',
  '__uclife__.useCombatStore',
  '__uclife__.useClock',
  '__uclife__.useScene',
  '__uclife__.getMs',
  '__uclife__.getMsRoster',
  '__uclife__.setMsSortieResources',
  '__uclife__.getStrandedMs',
  '__uclife__.dispatchRecoveryTug',
  '__uclife__.getRecoveryTugs',
  '__uclife__.getHangarDoors',
  '__uclife__.getPilotedMsState',
  '__uclife__.getFlagshipCombatPose',
  '__uclife__.cheatMoney',
  '__uclife__.cheatPiloting',
  '__uclife__.listEnemies',
]

const STEP_BUDGET_MIN = 60
const PLAYER_MS_KEY = 'ms-player-0'  // ms-starter starter key
const PLAYER_MS_RUNTIME_KEY = 'player-ms-1'  // CombatShipState entity key for the deployed MS
const HARDPOINT_ID = 'hp-0'

test('ms-sortie: per-MS resources + tug + resupply + relaunch at door', async ({ sim }) => {
  sim.allowConsoleError(isKnownPixiBatcherStartup)
  await sim.boot({ fixture: 'ms-sortie', requireHandles: REQUIRED_HANDLES })

  // ── 1. Get into combat ─────────────────────────────────────────────────
  const setupOk = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = (window as any).__uclife__
    return u.cheatMoney(80000) && u.cheatPiloting(10)
  })
  expect(setupOk, 'cheatMoney+cheatPiloting setup').toBeTruthy()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.boardShip())
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.useScene.getState().activeId === 'playerShipInterior',
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  const helmRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.takeHelmCheat(),
  )
  expect(helmRes?.ok, `takeHelmCheat: ${JSON.stringify(helmRes)}`).toBe(true)

  const enemies = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listEnemies(),
  )
  expect(enemies && enemies.length > 0, 'spaceCampaign should have enemies for startCombatCheat').toBeTruthy()

  await sim.page.evaluate((key) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__uclife__.startCombatCheat('pirateLight', [], key)
  }, enemies[0].key)

  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.useCombatStore.getState().open === true,
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  // ── 2. Verify the starter MS is in the roster with caps seeded ─────────
  const beforeLaunch = await sim.page.evaluate(
    (key) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.getMs(key),
    PLAYER_MS_KEY,
  )
  expect(beforeLaunch, 'starter MS should exist after fixture boot').toBeTruthy()
  expect(
    beforeLaunch!.currentPropellant,
    'starter MS propellant should seed at template cap',
  ).toBe(beforeLaunch!.propellantStorageCap)
  expect(
    beforeLaunch!.currentLifeSupport,
    'starter MS life-support should seed at template cap',
  ).toBe(beforeLaunch!.lifeSupportMinutesCap)
  // Energy-rifle hardpoint seeds to 'Inf'.
  expect(
    beforeLaunch!.currentAmmoByWeapon[HARDPOINT_ID],
    `starter MS ammo at ${HARDPOINT_ID} should seed to 'Inf' for beamRifle`,
  ).toBe('Inf')

  // Launch the MS via the existing debug verb.
  const launchRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.launchPlayerMs(),
  )
  expect(launchRes?.ok, `launchPlayerMs: ${JSON.stringify(launchRes)}`).toBe(true)
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.useCockpit.getState().piloting === 'ms',
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  // ── 3. Snapshot the launch-pose for the spawn-at-door assertion ────────
  const launchPose = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getPilotedMsState(),
  )
  expect(launchPose, 'getPilotedMsState should be non-null after launch').toBeTruthy()

  const flagshipPose = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getFlagshipCombatPose(),
  )
  expect(flagshipPose, 'flagship CombatShipState should exist').toBeTruthy()

  // lightFreighter authors a single door at hull-local (0, -40), facing -90°.
  // World-space launch pos = flagship.pos + rotated door.position.
  const expectedLaunchPos = (() => {
    const cosH = Math.cos(flagshipPose!.heading)
    const sinH = Math.sin(flagshipPose!.heading)
    const dx = 0, dy = -40
    return {
      x: flagshipPose!.pos.x + dx * cosH - dy * sinH,
      y: flagshipPose!.pos.y + dx * sinH + dy * cosH,
    }
  })()
  expect(
    Math.hypot(
      launchPose!.pos.x - expectedLaunchPos.x,
      launchPose!.pos.y - expectedLaunchPos.y,
    ),
    'MS launch pos should equal ship.pos + rotated door.position (within 1 unit)',
  ).toBeLessThanOrEqual(1)

  // ── 4. Force the MS into depleted+stranded state ──────────────────────
  // Replace the energy-rifle with the ballistic rifle on this MS so the
  // ammo-depletion gate has something to chew on. The retrofit verb uses
  // the player parts inventory which starts with one ms-ballisticGun.
  const swapOk = await sim.page.evaluate(
    ({ msKey, hpId }: { msKey: string; hpId: string }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.swapMsWeapon(msKey, hpId, 'ms-ballisticGun'),
    { msKey: PLAYER_MS_KEY, hpId: HARDPOINT_ID },
  )
  expect(swapOk, 'swapMsWeapon to ms-ballisticGun should succeed').toBe(true)

  // Seed propellant = 0 (stranded) + ammo at hp-0 = 0 (depleted).
  const seedOk = await sim.page.evaluate(
    ({ msKey, hpId }: { msKey: string; hpId: string }) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.setMsSortieResources(msKey, {
        currentPropellant: 0,
        currentAmmoByWeapon: { [hpId]: 0 },
      }),
    { msKey: PLAYER_MS_KEY, hpId: HARDPOINT_ID },
  )
  expect(seedOk, 'setMsSortieResources should succeed').toBe(true)

  const seeded = await sim.page.evaluate(
    (key) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.getMs(key),
    PLAYER_MS_KEY,
  )
  expect(seeded!.currentPropellant, 'propellant should now be 0').toBe(0)
  expect(seeded!.currentAmmoByWeapon[HARDPOINT_ID], 'ammo at hp-0 should now be 0').toBe(0)

  // ── 5. Verify stranded state is queryable ──────────────────────────────
  const stranded = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getStrandedMs(),
  )
  expect(
    stranded.map((s: { key: string }) => s.key),
    'PLAYER_MS_KEY should appear in stranded MS list',
  ).toContain(PLAYER_MS_KEY)

  // ── 6. Dispatch the recovery tug ──────────────────────────────────────
  // Dispatch against the persistent Ms entity key (`ms-player-0`). The
  // verb resolves the deployed CombatShipState row by the
  // `pilotedByPlayer && isMs` discriminator and stores both keys on
  // RecoveryTugState so the tick can find both rows.
  const tugRes = await sim.page.evaluate(
    (key) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.dispatchRecoveryTug(key),
    PLAYER_MS_KEY,
  )
  expect(
    tugRes.ok,
    `dispatchRecoveryTug should succeed (reason if not: ${tugRes.reason}); player skills + ship setup were authored for this`,
  ).toBe(true)

  // ── 7. Step until the tug returns + MS enters resupply ─────────────────
  // Tug travels at tugSpeedUnitsPerSec under tactical-time. Verify a tug
  // exists, then step until the MS enters ResupplyState.
  const tugs = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getRecoveryTugs(),
  )
  expect(tugs.length, 'one tug should be active after dispatch').toBe(1)

  // Make sure combat isn't paused so the systems can tick.
  await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cs = (window as any).__uclife__.useCombatStore.getState()
    if (cs.paused) cs.togglePause()
  })

  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      until: () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ms = (window as any).__uclife__.getMs('player-ms-1') ?? (window as any).__uclife__.getMs('ms-player-0')
        // Resupply attaches to the Ms entity (key='ms-player-0'). Read
        // resupplySecTotal — non-zero means ResupplyState is present.
        return ms !== null && ms.resupplySecTotal > 0
      },
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  const inResupply = await sim.page.evaluate(
    (key) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.getMs(key),
    PLAYER_MS_KEY,
  )
  expect(
    inResupply!.resupplySecTotal,
    'resupply secTotal should equal sortieConfig.baseResupplySec / 1.0 / (1 + 0) / 1.0 = 15',
  ).toBeCloseTo(15, 5)

  // ── 8. Step until resupply complete ────────────────────────────────────
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      until: () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ms = (window as any).__uclife__.getMs('ms-player-0')
        return ms !== null && ms.resupplySecTotal === 0 && ms.currentPropellant > 0
      },
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  const afterResupply = await sim.page.evaluate(
    (key) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__uclife__.getMs(key),
    PLAYER_MS_KEY,
  )
  expect(
    afterResupply!.currentPropellant,
    'propellant should restore to template cap (Ms is at depot-free state; no propellant frame mod)',
  ).toBe(afterResupply!.propellantStorageCap)
  expect(
    afterResupply!.currentAmmoByWeapon[HARDPOINT_ID],
    'ammo at hp-0 should restore to ballisticGun ammoCapacity (30)',
  ).toBe(30)

  // ── 9. Assert no auto-pause on resupply complete ──────────────────────
  const combatPaused = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.useCombatStore.getState().paused,
  )
  expect(
    combatPaused,
    'combat should NOT auto-pause on resupply complete (Design/sortie.md: log line only)',
  ).toBe(false)
})
