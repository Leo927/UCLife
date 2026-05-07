// Save → advance sim time → load → verify the clock round-tripped.
// Driven entirely through __uclife__: pause via useClock.setSpeed(0),
// save/load via the saveGame/loadGame handles (same code path as the
// system menu), advance via advanceGameDays — no real-time waits.

import { chromium } from 'playwright'

const url = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof globalThis.__uclife__?.saveGame === 'function'
    && typeof globalThis.__uclife__?.loadGame === 'function'
    && typeof globalThis.__uclife__?.advanceGameDays === 'function'
    && typeof globalThis.__uclife__?.useClock?.getState === 'function',
  null,
  { timeout: 30_000 },
)

const readClock = () => page.evaluate(() => globalThis.__uclife__.useClock.getState().gameDate.getTime())

await page.evaluate(() => globalThis.__uclife__.useClock.getState().setSpeed(0))

const savedClock = await readClock()
const saveResult = await page.evaluate(async () => {
  await globalThis.__uclife__.saveGame(1)
  return true
})
if (!saveResult) errors.push('saveGame returned falsy')

await page.evaluate(() => globalThis.__uclife__.advanceGameDays(2))
const advancedClock = await readClock()

const loadResult = await page.evaluate(async () => globalThis.__uclife__.loadGame(1))
if (!loadResult || loadResult.ok !== true) {
  errors.push(`loadGame failed: ${JSON.stringify(loadResult)}`)
}

const reloadedClock = await readClock()

console.log('saved   :', new Date(savedClock).toISOString())
console.log('advanced:', new Date(advancedClock).toISOString())
console.log('reloaded:', new Date(reloadedClock).toISOString())

const failures = []
if (savedClock === advancedClock) failures.push('advanceGameDays did not advance the clock')
if (savedClock !== reloadedClock) failures.push(`reloaded clock ${reloadedClock} != saved ${savedClock}`)

if (errors.length) {
  console.log('\nERRORS:')
  errors.forEach((e) => console.log('  ' + e))
}
if (failures.length) {
  console.log('\nFAILURES:')
  failures.forEach((f) => console.log('  ' + f))
}

await browser.close()

if (errors.length || failures.length) process.exit(1)
console.log('\nOK: save/load round-trip restored the clock.')
