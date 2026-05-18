// Verify the engagement → tactical → resolution loop:
//   1. Boot via ?test=1, board, take helm.
//   2. Pick a campaign-world enemy, jump straight into combat with startCombatCheat.
//   3. Verify useCombatStore.open === true and clock.mode === 'combat'.
//   4. fastWinCombat + endCombatCheat('victory') drive resolution.
//   5. Verify combat closed, clock.mode === 'normal', enemy entity destroyed.

import { test, expect, DOM_COMMIT_TIMEOUT_MS, isKnownPixiBatcherStartup } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.takeHelmCheat',
  '__uclife__.startCombatCheat',
  '__uclife__.fastWinCombat',
  '__uclife__.endCombatCheat',
  '__uclife__.listEnemies',
  '__uclife__.cheatMoney',
  '__uclife__.cheatPiloting',
  '__uclife__.setShipOwned',
  '__uclife__.boardShip',
  '__uclife__.useScene',
]

const STARTUP_MONEY = 80_000
const STARTUP_PILOTING = 10

test('space combat: engagement loop with victory cleanup', async ({ sim }) => {
  sim.allowConsoleError(isKnownPixiBatcherStartup)
  await sim.boot({ requireHandles: REQUIRED_HANDLES })

  const setupOk = await sim.page.evaluate(
    (args) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const u = (window as any).__uclife__
      return u.cheatMoney(args.money) && u.cheatPiloting(args.piloting) && u.setShipOwned()
    },
    { money: STARTUP_MONEY, piloting: STARTUP_PILOTING },
  )
  expect(setupOk, 'cheat-money/piloting/ownership setup failed').toBeTruthy()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.boardShip())
  await sim.page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.useScene.getState().activeId === 'playerShipInterior',
    null,
    { timeout: DOM_COMMIT_TIMEOUT_MS },
  )

  const helmRes = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.takeHelmCheat(),
  )
  expect(helmRes?.ok, `takeHelmCheat failed: ${helmRes?.message}`).toBe(true)

  await sim.page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.useScene.getState().activeId === 'spaceCampaign',
    null,
    { timeout: DOM_COMMIT_TIMEOUT_MS },
  )

  const enemies = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listEnemies(),
  )
  expect(enemies.length, 'no enemies present in spaceCampaign').toBeGreaterThan(0)
  const target = enemies[0]

  await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (key) => (window as any).__uclife__.startCombatCheat('pirateLight', [], key),
    target.key,
  )

  const openedCombat = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    return {
      open: w.__uclife__.useCombatStore.getState().open,
      mode: w.__uclife__.useClock.getState().mode,
    }
  })
  expect(openedCombat.open, 'tactical view did not open').toBe(true)
  expect(openedCombat.mode, `clock mode = ${openedCombat.mode}`).toBe('combat')

  const won = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.fastWinCombat(),
  )
  expect(won, 'fastWinCombat returned false (no enemy entity)').toBe(true)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.endCombatCheat('victory'))

  const resolved = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    return {
      open: w.__uclife__.useCombatStore.getState().open,
      mode: w.__uclife__.useClock.getState().mode,
    }
  })
  expect(resolved.open, `combat still open after endCombatCheat`).toBe(false)
  expect(resolved.mode, `clock mode after victory = ${resolved.mode}`).toBe('normal')

  const survivorList = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listEnemies(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stillThere = survivorList.find((e: any) => e.key === target.key)
  expect(stillThere, `campaign enemy ${target.key} still alive after victory`).toBeUndefined()
})
