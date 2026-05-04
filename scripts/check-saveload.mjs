import { chromium } from 'playwright'
import { dismissAmbitionPicker } from './lib/dismissPicker.mjs'

const url = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await dismissAmbitionPicker(page)

// Pause first so save captures a stable clock.
await page.locator('.hud-controls button', { hasText: '暂停' }).click()
await page.waitForTimeout(200)

const openSystem = async () => {
  await page.locator('button.hud-system').click()
  await page.waitForTimeout(300)
}
const closeSystem = async () => {
  await page.locator('.status-overlay').click({ position: { x: 5, y: 5 } }).catch(() => {})
  await page.waitForTimeout(200)
}
const slotRow = (label) => page.locator('.debug-row', { has: page.locator('.debug-row-label', { hasText: label }) })

await openSystem()
await slotRow('存档 1').locator('button.debug-action', { hasText: '保存' }).click()
await page.waitForTimeout(800)

const savedClock = await page.locator('.hud-title').textContent()

await closeSystem()
await page.locator('.hud-controls button', { hasText: '4×' }).click()
await page.waitForTimeout(2500)

const advancedClock = await page.locator('.hud-title').textContent()

await openSystem()
await slotRow('存档 1').locator('button.debug-action', { hasText: '读档' }).click()
await page.waitForTimeout(1500)
await closeSystem()

const reloadedClock = await page.locator('.hud-title').textContent()

console.log('saved   :', savedClock)
console.log('advanced:', advancedClock)
console.log('reloaded:', reloadedClock)

if (errors.length) {
  console.log('\nERRORS:')
  errors.forEach((e) => console.log('  ' + e))
}

const ok = savedClock === reloadedClock && savedClock !== advancedClock && errors.length === 0
console.log(ok ? '\nOK: round-trip restored clock.' : '\nFAIL: round-trip did not pass.')
if (!ok) process.exitCode = 1

await browser.close()
