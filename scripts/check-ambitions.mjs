// Phase 6 deterministic migration of the ambitions smoke. Boots via
// ?test=1, drives the ambitions slot + stage tick + save/reload round-
// trip through the debug handle.
//
// Coverage:
//   1. No panel auto-opens at start.
//   2. pickAmbitions(['mw_pilot', 'lazlos_owner']) seats the slots.
//   3. After raising reflex+athletics and one game-day tick, mw_pilot
//      promotes from stage 0 → stage 1, the Character.title updates,
//      and the stage event lands in the event log.
//   4. The ambitions panel renders the new title.
//   5. Save → reload (same ?test=1 URL) → load preserves the slot.

import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import { mkdir } from 'node:fs/promises'

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1', baseUrl).toString()

await mkdir('scripts/out', { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

const EXPECTED_TITLE = '机工预备生'

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.getAmbitions === 'function'
    && typeof window.__uclife__?.pickAmbitions === 'function'
    && typeof window.__uclife__?.setPlayerStat === 'function'
    && typeof window.__uclife__?.runAmbitionsTick === 'function'
    && typeof window.__uclife__?.getEventLog === 'function'
    && typeof window.__uclife__?.saveGame === 'function'
    && typeof window.__uclife__?.loadGame === 'function',
  null,
  { timeout: 30_000 },
)

// 1. Panel must NOT auto-open at start; player should have a default ambition slot.
const overlayCount = await page.locator('.status-overlay').count()
assert.equal(
  overlayCount, 0,
  `no overlay should auto-open at start; got ${overlayCount}`,
)

const initial = await page.evaluate(() => window.__uclife__.getAmbitions())
assert.ok(
  initial?.active?.length > 0,
  `player should boot with a pre-seeded ambition slot; got ${JSON.stringify(initial)}`,
)

// 2. Replace placeholder with mw_pilot + lazlos_owner.
await page.evaluate(() => {
  return window.__uclife__.pickAmbitions(['mw_pilot', 'lazlos_owner'])
})

// 3. Mutate stats so mw_pilot stage 1 thresholds clear, advance one game-
//    day via the bespoke verb (clock-only mutation), then force one
//    ambitions tick. step() over 24h hits MAX_STEP_TICKS — and would
//    over-tick every other system anyway. advanceGameDays is a clock
//    bump only, not a sim tick, so it's the right scoped verb.
await page.evaluate(() => {
  window.__uclife__.setPlayerStat('attributes.reflex', 35)
  window.__uclife__.setPlayerStat('skills.athletics', 600)
})
await page.evaluate(() => window.__uclife__.advanceGameDays(1))
await page.evaluate(() => window.__uclife__.runAmbitionsTick())

const after = await page.evaluate(() => ({
  amb: window.__uclife__.getAmbitions(),
  log: window.__uclife__.getEventLog(),
}))
assert.equal(
  after.amb?.title, EXPECTED_TITLE,
  `Character.title should be "${EXPECTED_TITLE}" after stage 1 promotion; got "${after.amb?.title}"`,
)

const mwSlot = after.amb?.active?.find((s) => s.id === 'mw_pilot')
assert.ok(mwSlot, 'mw_pilot slot missing from active list')
assert.equal(
  mwSlot.currentStage, 1,
  `mw_pilot.currentStage should be 1 after threshold clear; got ${mwSlot.currentStage}`,
)

const stageLog = after.log.find((e) => e.textZh.includes('体检合格'))
assert.ok(stageLog, 'expected stage-1 "体检合格" log line not found in event log')

// 4. Open panel manually, screenshot view mode.
await page.evaluate(() => { window.uclifeUI.getState().setAmbitions(true) })
await page.waitForSelector('.status-panel', { timeout: 5_000 })
await page.screenshot({ path: 'scripts/out/ambition-view.png', fullPage: false })

// StatusPanel.tsx renders the title in [data-player-title]. The
// ambitions panel may or may not include it; fall back to opening the
// status panel if the data attribute isn't on the ambitions view.
let titleEl = await page.locator('[data-player-title]').first().textContent().catch(() => null)
if (!titleEl || !titleEl.includes(EXPECTED_TITLE)) {
  await page.evaluate(() => {
    window.uclifeUI.getState().setAmbitions(false)
    window.uclifeUI.getState().setStatus(true)
  })
  await page.waitForSelector('.status-panel [data-player-title]', { timeout: 5_000 })
  titleEl = await page.locator('[data-player-title]').first().textContent().catch(() => null)
}
assert.ok(
  titleEl && titleEl.includes(EXPECTED_TITLE),
  `StatusPanel [data-player-title] should contain "${EXPECTED_TITLE}"; got "${titleEl}"`,
)
await page.evaluate(() => {
  window.uclifeUI.getState().setStatus(false)
  window.uclifeUI.getState().setAmbitions(false)
})

// 5. Save → reload (still ?test=1) → load → assert persistence.
await page.evaluate(async () => { await window.__uclife__.saveGame(1) })

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.getAmbitions === 'function'
    && typeof window.__uclife__?.loadGame === 'function',
  null,
  { timeout: 30_000 },
)

await page.evaluate(async () => { await window.__uclife__.loadGame(1) })

// loadGame does not advance the clock; the ambitions data is restored
// synchronously by the load handlers. Verify in one read.
const restored = await page.evaluate(() => window.__uclife__.getAmbitions())
const mwSlot2 = restored?.active?.find((s) => s.id === 'mw_pilot')
assert.ok(mwSlot2, 'after load, mw_pilot slot missing from active list')
assert.equal(
  mwSlot2.currentStage, 1,
  `after load, mw_pilot.currentStage should be 1; got ${mwSlot2.currentStage}`,
)
assert.equal(
  restored?.title, EXPECTED_TITLE,
  `after load, Character.title should be "${EXPECTED_TITLE}"; got "${restored?.title}"`,
)

assert.equal(
  errors.length, 0,
  `page error(s) during test:\n${errors.map((e) => '  ' + e).join('\n')}`,
)

await browser.close()

console.log('OK — check-ambitions:')
console.log(`  ambition slot picks: mw_pilot + lazlos_owner`)
console.log(`  stage 0→1 promotion: title="${after.amb.title}" log="${stageLog.textZh}"`)
console.log(`  save → reload → load preserved mw_pilot stage 1 + title`)
