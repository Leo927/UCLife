// Phase 6 deterministic pilot — system menu via the migrated stack.
//
// Covers, in one test, every deterministic primitive shipped in Phases 1-5:
//   - URL boot: `?test=1&fixture=minimal-player-only`
//   - JSON5 fixture: tests/fixtures/minimal-player-only.json5
//   - Real Playwright input: `page.click('button.hud-system')` + `page.keyboard.press('Escape')`
//   - Sole wait primitive for sim consequences: `__uclife_test__.step()`
//   - Fluent read-only view: `__uclife__.getGameState()`
//
// See Design/test-migration-playbook.md for the recipe this test follows.
//
// Note on fixture player money: bootstrapApp() spawns a default player
// before applyFixture() runs, so the fixture's player.money is shadowed
// by the boot player in the same scene (Phase 5 limitation — see
// "Known gaps" in the playbook). This pilot asserts on the *deterministic
// floor* — scene id, clock advancement, getGameState() round-trip — and
// leaves fixture-state assertions for a follow-up once the loader's
// world-reset story lands.

import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'

const FIXTURE = 'minimal-player-only'
const FIXTURE_SCENE_ID = 'vonBraunCity'
const STEP_GAME_MINUTES = 5
const MS_PER_GAME_MINUTE = 60_000
const BOOT_READY_TIMEOUT_MS = 30_000
const DOM_COMMIT_TIMEOUT_MS = 5_000

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL(`?test=1&fixture=${FIXTURE}`, baseUrl).toString()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push(`console.error: ${m.text()}`)
})

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })

// Boot-existence one-shot — CLAUDE.md allows waitForFunction for module-load
// checks, never for sim state.
await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.getGameState === 'function',
  null,
  { timeout: BOOT_READY_TIMEOUT_MS },
)

// 1. URL boot landed the test runtime + getGameState reports the boot scene.
const initial = await page.evaluate(() => {
  const gs = window.__uclife__.getGameState()
  return {
    sceneId: gs.getScene().getId(),
    sceneDims: gs.getScene().getDimensions(),
    playerMoney: gs.getPlayerCharacter().getResource('Money'),
    clockMs: window.__uclife__.useClock.getState().gameDate.getTime(),
  }
})
assert.equal(initial.sceneId, FIXTURE_SCENE_ID,
  `fixture/boot scene id should be ${FIXTURE_SCENE_ID}, got ${initial.sceneId}`)
assert.ok(initial.sceneDims.tilesX > 0 && initial.sceneDims.tilesY > 0,
  `scene dims should be populated; got ${JSON.stringify(initial.sceneDims)}`)
assert.ok(typeof initial.playerMoney === 'number' && initial.playerMoney >= 0,
  `getPlayerCharacter().getResource('Money') should be a non-negative number; got ${initial.playerMoney}`)

// 2. step({ gameMinutes }) is the sole wait primitive for sim time. Clock
//    is frozen in test mode; this is the only legal way to move it.
await page.evaluate(async (mins) => {
  await window.__uclife_test__.step({ gameMinutes: mins })
}, STEP_GAME_MINUTES)

const afterStep = await page.evaluate(() => ({
  sceneId: window.__uclife__.getGameState().getScene().getId(),
  clockMs: window.__uclife__.useClock.getState().gameDate.getTime(),
}))
const clockDeltaMs = afterStep.clockMs - initial.clockMs
assert.equal(clockDeltaMs, STEP_GAME_MINUTES * MS_PER_GAME_MINUTE,
  `step({ gameMinutes: ${STEP_GAME_MINUTES} }) should advance clock by ` +
  `${STEP_GAME_MINUTES * MS_PER_GAME_MINUTE}ms, got ${clockDeltaMs}ms`)
assert.equal(afterStep.sceneId, FIXTURE_SCENE_ID,
  `scene id should not drift across step(); got ${afterStep.sceneId}`)

// 3. step({ until }) — the predicate form. Verify it short-circuits when
//    the predicate is already true (zero ticks) and that it can satisfy a
//    clock-based predicate after one game-minute.
const untilZeroTickMs = await page.evaluate(async () => {
  const before = window.__uclife__.useClock.getState().gameDate.getTime()
  await window.__uclife_test__.step({ until: () => true, maxGameMinutes: 1 })
  return window.__uclife__.useClock.getState().gameDate.getTime() - before
})
assert.equal(untilZeroTickMs, 0,
  `step({ until: () => true }) should not advance clock; got ${untilZeroTickMs}ms`)

const targetClockMs = afterStep.clockMs + MS_PER_GAME_MINUTE
await page.evaluate(async (target) => {
  await window.__uclife_test__.step({
    until: () => window.__uclife__.useClock.getState().gameDate.getTime() >= target,
    maxGameMinutes: 2,
  })
}, targetClockMs)
const afterUntil = await page.evaluate(() =>
  window.__uclife__.useClock.getState().gameDate.getTime(),
)
assert.ok(afterUntil >= targetClockMs,
  `step({ until }) should satisfy clock-based predicate; ${afterUntil} < ${targetClockMs}`)

// 4. Real Playwright input: the HUD system button. No store-poking shortcut.
await page.click('button.hud-system')

// 5. The React commit for the panel mount is a DOM event, not a sim event.
//    waitForSelector for DOM readiness is allowed in test mode (we're
//    waiting for React's commit, not for the clock to advance).
await page.waitForSelector('.status-panel .status-header h2', { timeout: DOM_COMMIT_TIMEOUT_MS })

const menu = await page.evaluate(() => {
  const header = document.querySelector('.status-panel .status-header h2')?.textContent?.trim() ?? null
  const buttons = Array.from(document.querySelectorAll('.status-panel button.debug-action'))
    .map((b) => b.textContent?.trim())
  const checkboxes = document.querySelectorAll('.status-panel input[type="checkbox"]').length
  return { header, buttons, checkboxes }
})
assert.equal(menu.header, '系统', `system panel header should be '系统', got '${menu.header}'`)
assert.ok(menu.buttons.includes('保存'),
  `system panel should include 保存 button; got ${JSON.stringify(menu.buttons)}`)
assert.ok(menu.buttons.includes('读档'),
  `system panel should include 读档 button; got ${JSON.stringify(menu.buttons)}`)
assert.ok(menu.buttons.includes('删除'),
  `system panel should include 删除 button; got ${JSON.stringify(menu.buttons)}`)
assert.equal(menu.checkboxes, 1, `system panel should expose 1 checkbox, got ${menu.checkboxes}`)

// 6. Real Playwright input: Escape closes the menu. The Hud keydown
//    handler attaches in a React useEffect — once the menu is mounted
//    above (waitForSelector resolved), the listener is guaranteed live,
//    so we don't need a probe key.
await page.keyboard.press('Escape')
await page.waitForFunction(
  () => window.uclifeUI.getState().systemOpen === false,
  null, { timeout: DOM_COMMIT_TIMEOUT_MS },
)

// 7. getGameState() unchanged after the UI round-trip. The system menu
//    doesn't mutate sim state — every read goes back through the
//    deterministic facade.
const final = await page.evaluate(() => {
  const gs = window.__uclife__.getGameState()
  return {
    sceneId: gs.getScene().getId(),
    playerMoney: gs.getPlayerCharacter().getResource('Money'),
    clockMs: window.__uclife__.useClock.getState().gameDate.getTime(),
  }
})
assert.equal(final.sceneId, FIXTURE_SCENE_ID,
  `scene id should be stable across UI round-trip; got ${final.sceneId}`)
assert.equal(final.playerMoney, initial.playerMoney,
  `player money should be stable across UI round-trip; ${initial.playerMoney} → ${final.playerMoney}`)
assert.equal(final.clockMs, afterUntil,
  `clock should be stable across UI round-trip (frozen except via step()); ` +
  `${afterUntil} → ${final.clockMs}`)

assert.equal(pageErrors.length, 0,
  `page error(s) during test:\n${pageErrors.map((e) => '  ' + e).join('\n')}`)

console.log('OK — check-systemmenu (deterministic pilot):')
console.log(`  fixture=${FIXTURE}  scene=${FIXTURE_SCENE_ID}  player.money=${initial.playerMoney}`)
console.log(`  step({ gameMinutes: ${STEP_GAME_MINUTES} }) Δclock=${clockDeltaMs}ms`)
console.log(`  step({ until: () => true }) Δclock=${untilZeroTickMs}ms`)
console.log(`  step({ until: clock≥target }) reached=${afterUntil >= targetClockMs}`)
console.log(`  system menu: header='${menu.header}' buttons=[${menu.buttons.join(',')}] checkboxes=${menu.checkboxes}`)

await browser.close()
