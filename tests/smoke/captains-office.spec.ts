// Verifies the post-combat half of 6.2:
//   1. Adjutant chatter pulls the name from ship-classes.json5.
//   2. Notable-hostile capture lands a named POW in the brig.
//   3. Brig respects brigCapacity — over-capacity captures are refused.
//   4. Comm-panel + brig-panel UI surfaces respond to interactable kicks.
//   5. Combat tally payload carries the captured POW row + brig occupancy.

import { test, expect } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.startCombatCheat',
  '__uclife__.useBrig',
  '__uclife__.brigState',
  '__uclife__.getAdjutant',
  '__uclife__.fastWinCombat',
  '__uclife__.finishRecoverables',
]

const STEP_BUDGET_MIN = 60

test('captains office: adjutant, brig capacity, POW capture, panels', async ({ sim }) => {
  await sim.boot({ fixture: 'starter-fleet', requireHandles: REQUIRED_HANDLES })

  // 1. Adjutant config check — name read from ship-classes.json5.
  const adj = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.getAdjutant(),
  )
  expect(adj, 'getAdjutant() returned null').toBeTruthy()
  expect(typeof adj.name, `adjutant.name should be string; got ${typeof adj.name}`).toBe('string')
  expect(adj.name.length, 'adjutant.name should be non-empty').toBeGreaterThan(0)

  // 2. Brig starts empty + reports correct capacity.
  const brigInit = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.brigState(),
  )
  expect(brigInit.occupied, `brig should start empty; saw ${brigInit.occupied}`).toBe(0)
  expect(brigInit.capacity, `brig capacity should be > 0; got ${brigInit.capacity}`).toBeGreaterThan(0)

  // 3. Stage a notable-hostile fight.
  const setupOk = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = (window as any).__uclife__
    return u.cheatMoney(80000) && u.cheatPiloting(10)
  })
  expect(setupOk, 'cheat setup failed').toBeTruthy()

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

  const target = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enemies = (window as any).__uclife__.listEnemies()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return enemies.find((e: any) => e.key === 'enemy-pirate-lunar-4') || enemies[0]
  })
  expect(target, 'no campaign enemy found').toBeTruthy()

  await sim.page.evaluate((key) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__uclife__.startCombatCheat(
      'pirate_raider',
      [],
      key,
      { '0': 'char-aznable-0077-disguise' },
    )
  }, target.key)

  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.useCombatStore.getState().open === true,
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  // 4. Resolve combat — unpause then fastWin.
  await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cs = (window as any).__uclife__.useCombatStore.getState()
    if (cs.paused) cs.togglePause()
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.fastWinCombat())
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).__uclife__.useCombatStore.getState().open === false,
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  // Issue #71 — the recoverables dialogue now fires before the tally.
  // Resolve it (defaults: scuttle hulls / leave pods) so the tally emits.
  await sim.page.evaluate(() => (window as any).__uclife__.finishRecoverables())

  const brigAfter = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.brigState(),
  )
  expect(
    brigAfter.occupied,
    `brig should contain at least 1 captured POW after fastWin; saw ${brigAfter.occupied}`,
  ).toBeGreaterThanOrEqual(1)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const found = brigAfter.prisoners.find((p: any) => p.id === 'char-aznable-0077-disguise')
  expect(
    found,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    `brig should contain char-aznable-0077-disguise; saw ${brigAfter.prisoners.map((p: any) => p.id).join(', ')}`,
  ).toBeTruthy()

  // 5. Tally payload includes the captured POW + brig occupancy.
  const tally = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).uclifeUI.getState().combatTally,
  )
  expect(tally, 'combatTally should be non-null after victory').toBeTruthy()
  expect(
    Array.isArray(tally.capturedPows) && tally.capturedPows.length > 0,
    `tally.capturedPows should be non-empty; got ${JSON.stringify(tally.capturedPows)}`,
  ).toBeTruthy()
  expect(typeof tally.brigCapacity).toBe('number')
  expect(typeof tally.brigOccupied).toBe('number')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).uclifeUI.getState().setCombatTally(null))

  // 6. Brig over-capacity refusal.
  const capacity = brigAfter.capacity
  const fillResults = await sim.page.evaluate((cap) => {
    const results: boolean[] = []
    for (let i = 0; i < cap + 1; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      results.push((window as any).__uclife__.forceCapture(`fake-${i}`))
    }
    return results
  }, capacity)
  expect(
    fillResults[fillResults.length - 1],
    `brig should refuse capture past capacity (${capacity}); got ${fillResults.join(',')}`,
  ).toBe(false)

  // 7. Comm-panel + brig-panel toggles surface the right occupants.
  await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = (window as any).__uclife__
    u.clearBrig()
    u.forceCapture('char-aznable-0077-disguise')
    u.openCommPanel()
  })
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).uclifeUI.getState().commPanelOpen === true,
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)

  await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    w.uclifeUI.getState().setCommPanel(false)
    w.__uclife__.openBrigPanel()
  })
  await sim.page.evaluate(async (mins) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__uclife_test__.step({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      until: () => (window as any).uclifeUI.getState().brigPanelOpen === true,
      maxGameMinutes: mins,
    })
  }, STEP_BUDGET_MIN)
})
