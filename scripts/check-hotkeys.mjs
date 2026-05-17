// Phase 6 deterministic migration of the hotkeys smoke. Verifies the Hud's
// keydown handler:
//   1. C opens status; ESC closes status; C toggles back open then closed.
//   2. I opens inventory; ESC closes inventory.
//   3. C while inventory open is a no-op (anyModal block); inventory stays.
//   4. ESC with no modal open is a no-op.
//   5. ESC closes the system menu (opened directly via the UI store).
//
// Migrated to the deterministic stack: ?test=1&fixture=minimal-player-only,
// real `page.keyboard.press()` for every hotkey, listener-readiness is the
// .hud root being mounted (its useEffect attaches keydown then). Sim time
// never advances — UI store is browser-side, not sim state.

import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import {
  BOOT_READY_TIMEOUT_MS, DOM_COMMIT_TIMEOUT_MS, VIEWPORT,
  isExpectedTestModePortraitMissing,
} from './_test-constants.mjs'

const FIXTURE = 'minimal-player-only'

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL(`?test=1&fixture=${FIXTURE}`, baseUrl).toString()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: VIEWPORT })
const page = await ctx.newPage()

const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const line = `console.error: ${m.text()}`
  if (isExpectedTestModePortraitMissing(line)) return
  pageErrors.push(line)
})

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.getGameState === 'function'
    && typeof window.uclifeUI?.getState === 'function',
  null,
  { timeout: BOOT_READY_TIMEOUT_MS },
)

// Wait for the Hud root to commit. The Hud's keydown listener is attached
// in a useEffect, so once the `.hud` element is in the DOM the listener is
// guaranteed live. No probe-key trick needed under the deterministic boot.
await page.waitForSelector('.hud', { timeout: DOM_COMMIT_TIMEOUT_MS })

const readState = () => page.evaluate(() => {
  const s = window.uclifeUI.getState()
  return {
    statusOpen: s.statusOpen,
    inventoryOpen: s.inventoryOpen,
    mapOpen: s.mapOpen,
    systemOpen: s.systemOpen,
  }
})

// 1. C opens, ESC closes, C reopens, C closes.
await page.keyboard.press('c')
let s = await readState()
assert.equal(s.statusOpen, true, `C should open status, got ${JSON.stringify(s)}`)

await page.keyboard.press('Escape')
s = await readState()
assert.equal(s.statusOpen, false, `ESC should close status, got ${JSON.stringify(s)}`)

await page.keyboard.press('c')
s = await readState()
assert.equal(s.statusOpen, true, `C should re-open status, got ${JSON.stringify(s)}`)

await page.keyboard.press('c')
s = await readState()
assert.equal(s.statusOpen, false, `C should toggle status off, got ${JSON.stringify(s)}`)

// 2. I opens inventory, ESC closes.
await page.keyboard.press('i')
s = await readState()
assert.equal(s.inventoryOpen, true, `I should open inventory, got ${JSON.stringify(s)}`)

await page.keyboard.press('Escape')
s = await readState()
assert.equal(s.inventoryOpen, false, `ESC should close inventory, got ${JSON.stringify(s)}`)

// 3. C while inventory open: no-op (anyModal block).
await page.evaluate(() => window.uclifeUI.getState().setInventory(true))
await page.keyboard.press('c')
s = await readState()
assert.equal(s.statusOpen, false,
  `C should not open status while inventory open, got ${JSON.stringify(s)}`)
assert.equal(s.inventoryOpen, true,
  `Inventory should remain open after C press, got ${JSON.stringify(s)}`)
await page.evaluate(() => window.uclifeUI.getState().setInventory(false))

// 4. ESC with no modal open: no-op (every modal stays closed).
await page.keyboard.press('Escape')
s = await readState()
assert.equal(s.statusOpen || s.inventoryOpen || s.mapOpen || s.systemOpen, false,
  `ESC opened something with no modal: ${JSON.stringify(s)}`)

// 5. ESC closes the system menu (opened via store, then real key press).
await page.evaluate(() => window.uclifeUI.getState().setSystem(true))
await page.keyboard.press('Escape')
s = await readState()
assert.equal(s.systemOpen, false, `ESC should close systemMenu, got ${JSON.stringify(s)}`)

assert.equal(pageErrors.length, 0,
  `page error(s) during test:\n${pageErrors.map((e) => '  ' + e).join('\n')}`)

console.log('OK — check-hotkeys (deterministic): C/I/ESC behave correctly')

await browser.close()
