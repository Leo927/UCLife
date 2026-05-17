// Save → advance sim time → load → verify the clock round-tripped.
// Driven entirely through the deterministic test runtime — clock is
// frozen by ?test=1, step() advances sim time, saveGame/loadGame run
// the same code path as the system menu.

import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import { BOOT_READY_TIMEOUT_MS } from './_test-constants.mjs'

const MINUTES_ADVANCED = 60
const SAVE_SLOT = 1

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1', baseUrl).toString()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console.error: ${m.text()}`) })

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.saveGame === 'function'
    && typeof window.__uclife__?.loadGame === 'function'
    && typeof window.__uclife__?.getGameState === 'function',
  null, { timeout: BOOT_READY_TIMEOUT_MS },
)

const readClock = () => page.evaluate(
  () => window.__uclife__.useClock.getState().gameDate.getTime(),
)

const savedClock = await readClock()
await page.evaluate(async (slot) => { await window.__uclife__.saveGame(slot) }, SAVE_SLOT)

await page.evaluate(async (mins) => {
  await window.__uclife_test__.step({ gameMinutes: mins })
}, MINUTES_ADVANCED)
const advancedClock = await readClock()
assert.notEqual(savedClock, advancedClock,
  `step({ gameMinutes }) should advance the clock; both = ${savedClock}`)

const loadResult = await page.evaluate(async (slot) => window.__uclife__.loadGame(slot), SAVE_SLOT)
assert.equal(loadResult.ok, true, `loadGame failed: ${JSON.stringify(loadResult)}`)

const reloadedClock = await readClock()

console.log('saved   :', new Date(savedClock).toISOString())
console.log('advanced:', new Date(advancedClock).toISOString())
console.log('reloaded:', new Date(reloadedClock).toISOString())

assert.equal(reloadedClock, savedClock,
  `reloaded clock ${reloadedClock} != saved ${savedClock}`)

assert.equal(pageErrors.length, 0,
  `page error(s) during test:\n${pageErrors.map((e) => '  ' + e).join('\n')}`)

await browser.close()

console.log('\nOK: save/load round-trip restored the clock.')
