// system menu via the deterministic stack.
//   - URL boot: `?test=1&fixture=minimal-player-only`
//   - JSON5 fixture: tests/fixtures/minimal-player-only.json5
//   - Real Playwright input: click hud-system + Escape
//   - step() sole wait primitive for sim consequences
//   - getGameState() fluent view

import { test, expect, MS_PER_GAME_MINUTE, DOM_COMMIT_TIMEOUT_MS } from './_fixtures'

const FIXTURE = 'minimal-player-only'
const FIXTURE_SCENE_ID = 'vonBraunCity'
const STEP_GAME_MINUTES = 5

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.getGameState',
]

test('system menu: boot, step, real input, getGameState round-trip', async ({ sim }) => {
  await sim.boot({ fixture: FIXTURE, requireHandles: REQUIRED_HANDLES })

  // 1. URL boot landed the test runtime + getGameState reports the boot scene.
  const initial = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const gs = w.__uclife__.getGameState()
    return {
      sceneId: gs.getScene().getId(),
      sceneDims: gs.getScene().getDimensions(),
      playerMoney: gs.getPlayerCharacter().getResource('Money'),
      clockMs: w.__uclife__.useClock.getState().gameDate.getTime(),
    }
  })
  expect(initial.sceneId).toBe(FIXTURE_SCENE_ID)
  expect(
    initial.sceneDims.tilesX > 0 && initial.sceneDims.tilesY > 0,
    `scene dims should be populated; got ${JSON.stringify(initial.sceneDims)}`,
  ).toBeTruthy()
  expect(typeof initial.playerMoney === 'number' && initial.playerMoney >= 0).toBeTruthy()

  // 2. step({ gameMinutes }) advances clock deterministically.
  await sim.stepFor(STEP_GAME_MINUTES)

  const afterStep = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    return {
      sceneId: w.__uclife__.getGameState().getScene().getId(),
      clockMs: w.__uclife__.useClock.getState().gameDate.getTime(),
    }
  })
  const clockDeltaMs = afterStep.clockMs - initial.clockMs
  expect(clockDeltaMs).toBe(STEP_GAME_MINUTES * MS_PER_GAME_MINUTE)
  expect(afterStep.sceneId).toBe(FIXTURE_SCENE_ID)

  // 3. step({ until }) — predicate form. Short-circuit when true.
  const untilZeroTickMs = await sim.page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const before = w.__uclife__.useClock.getState().gameDate.getTime()
    await w.__uclife_test__.step({ until: () => true, maxGameMinutes: 1 })
    return w.__uclife__.useClock.getState().gameDate.getTime() - before
  })
  expect(untilZeroTickMs).toBe(0)

  const targetClockMs = afterStep.clockMs + MS_PER_GAME_MINUTE
  await sim.page.evaluate(async (target) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    await w.__uclife_test__.step({
      until: () => w.__uclife__.useClock.getState().gameDate.getTime() >= target,
      maxGameMinutes: 2,
    })
  }, targetClockMs)
  const afterUntil = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.useClock.getState().gameDate.getTime(),
  )
  expect(afterUntil).toBeGreaterThanOrEqual(targetClockMs)

  // 4. Real Playwright input: HUD system button.
  await sim.page.click('button.hud-system')
  await sim.page.waitForSelector('.status-panel .status-header h2', { timeout: DOM_COMMIT_TIMEOUT_MS })

  const menu = await sim.page.evaluate(() => {
    const header = document.querySelector('.status-panel .status-header h2')?.textContent?.trim() ?? null
    const buttons = Array.from(document.querySelectorAll('.status-panel button.debug-action'))
      .map((b) => b.textContent?.trim())
    const checkboxes = document.querySelectorAll('.status-panel input[type="checkbox"]').length
    return { header, buttons, checkboxes }
  })
  expect(menu.header, `system panel header should be '系统'`).toBe('系统')
  expect(menu.buttons.includes('保存'), `system panel should include 保存`).toBeTruthy()
  expect(menu.buttons.includes('读档'), `system panel should include 读档`).toBeTruthy()
  expect(menu.buttons.includes('删除'), `system panel should include 删除`).toBeTruthy()
  expect(menu.checkboxes, `system panel should expose 1 checkbox`).toBe(1)

  // 5. Escape closes the menu.
  await sim.page.keyboard.press('Escape')
  await sim.page.waitForFunction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).uclifeUI.getState().systemOpen === false,
    null,
    { timeout: DOM_COMMIT_TIMEOUT_MS },
  )

  // 6. getGameState() unchanged after the UI round-trip.
  const final = await sim.page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const gs = w.__uclife__.getGameState()
    return {
      sceneId: gs.getScene().getId(),
      playerMoney: gs.getPlayerCharacter().getResource('Money'),
      clockMs: w.__uclife__.useClock.getState().gameDate.getTime(),
    }
  })
  expect(final.sceneId).toBe(FIXTURE_SCENE_ID)
  expect(final.playerMoney).toBe(initial.playerMoney)
  expect(final.clockMs).toBe(afterUntil)
})
