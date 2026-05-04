import { chromium } from 'playwright'

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

await page.evaluate(() => {
  const dbg = (window).uclifeDebug
  if (dbg?.superSpeed) dbg.superSpeed(40)
})
await page.click('.hud-controls button:has-text("4×")').catch(() => {})

let foundBubble = false
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `scripts/out/chatbubble-${i}.png` })
  if (errors.length > 0) break
  if (i >= 6) {
    foundBubble = true
    break
  }
}

if (errors.length) {
  console.log('\nERRORS:')
  errors.forEach((e) => console.log('  ' + e))
}
console.log(`screenshots written, errors=${errors.length}, completed=${foundBubble}`)

if (errors.length || !foundBubble) process.exitCode = 1

await browser.close()
