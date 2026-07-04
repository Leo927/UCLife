// Verify the bridge ↔ hangar walk + MS pilot loop:
//   1. Boot, board, helm, jump straight into combat against a pirate.
//   2. By default piloting='flagship' and useCombatStore.open === true.
//   3. launchPlayerMs() → MS spawned, piloting='ms', tactical still open.
//   4. msState() reflects the live MS pose; pilotedByPlayer=true.
//   5. dockPlayerMs(true) → MS despawns, useCombatStore.open === false,
//      piloting=null. Combat itself is still engaged (clock.mode='combat').
//   6. takeFlagshipControl() → tactical re-opens, piloting='flagship'.
//   7. fastWinCombat → combat resolves cleanly.

import { test, expect } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.startCombatCheat',
  '__uclife__.launchPlayerMs',
  '__uclife__.dockPlayerMs',
  '__uclife__.takeFlagshipControl',
  '__uclife__.leaveBridgeCheat',
  '__uclife__.msState',
  '__uclife__.useCockpit',
]

const STEP_BUDGET_MIN = 60

test('cockpit: launch MS, dock, re-helm flagship', async ({ sim }) => {
  await sim.boot({ requireHandles: REQUIRED_HANDLES })

  // Boot + board + helm + jump into combat.
  const setupOk = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = (window as any).__uclife__
    return u.cheatMoney(80000) && u.cheatPiloting(10)
  })
  expect(setupOk, 'cheatMoney+cheatPiloting failed at setup').toBeTruthy()

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
  expect(helmRes?.ok, `takeHelmCheat should succeed; got ${JSON.stringify(helmRes)}`).toBe(true)

  const enemies = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listEnemies(),
  )
  expect(enemies && enemies.length > 0, 'no enemies present in spaceCampaign').toBeTruthy()

  await sim.page.evaluate((key) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__uclife__.startCombatCheat('pirateLight', [], key)
  }, enemies[0].key)

  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      until: () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__uclife__.useCombatStore.getState().open === true
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        && (window as any).__uclife__.useCockpit.getState().piloting === 'flagship',
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  // Launch the MS.
  const launchRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.launchPlayerMs(),
  )
  expect(launchRes?.ok, `launchPlayerMs should succeed; got ${JSON.stringify(launchRes)}`).toBe(true)
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.useCockpit.getState().piloting === 'ms',
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  const ms = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.msState(),
  )
  expect(ms, 'msState() returned null after launch').toBeTruthy()
  expect(ms.pilotedByPlayer, 'MS pilotedByPlayer should be true after launch').toBe(true)
  expect(
    ms.hullCurrent,
    `MS launched at less than full hull: ${ms.hullCurrent}/${ms.hullMax}`,
  ).toBe(ms.hullMax)

  // Force-dock the MS.
  const dockRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.dockPlayerMs(true),
  )
  expect(dockRes?.ok, `dockPlayerMs should succeed; got ${JSON.stringify(dockRes)}`).toBe(true)
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      until: () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__uclife__.msState() === null
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        && (window as any).__uclife__.useCockpit.getState().piloting === null
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        && (window as any).__uclife__.useCombatStore.getState().open === false,
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  const sceneAfterDock = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.useScene.getState().activeId,
  )
  expect(
    sceneAfterDock,
    `expected to be in playerShipInterior after dock; got "${sceneAfterDock}"`,
  ).toBe('playerShipInterior')

  // Re-take the helm via takeFlagshipControl.
  const helmAgain = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.takeFlagshipControl(),
  )
  expect(helmAgain?.ok, `takeFlagshipControl should succeed; got ${JSON.stringify(helmAgain)}`).toBe(true)
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      until: () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__uclife__.useCockpit.getState().piloting === 'flagship'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        && (window as any).__uclife__.useCombatStore.getState().open === true,
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  // Resolve cleanly via fastWinCombat.
  await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cs = (window as any).__uclife__.useCombatStore.getState()
    if (cs.paused) cs.togglePause()
  })
  const won = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fastWinCombat(),
  )
  expect(won, 'fastWinCombat returned false (no enemy entity)').toBeTruthy()
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.useCombatStore.getState().open === false,
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.useClock.getState().mode === 'normal',
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.useCockpit.getState().piloting === null,
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)
})
