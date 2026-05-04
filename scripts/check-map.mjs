import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const url = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
await mkdir('scripts/out', { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (err) => errors.push(`${err.name}: ${err.message}`))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

await page.evaluate(() => window.uclifeUI.getState().setMap(true))
await page.waitForTimeout(500)

const dom = await page.evaluate(() => ({
  panel: !!document.querySelector('.map-panel'),
  svg: !!document.querySelector('.map-svg'),
  rectCount: document.querySelectorAll('.map-svg rect').length,
  placeRows: document.querySelectorAll('.map-place-row').length,
  hereTags: Array.from(document.querySelectorAll('.map-place-here')).map((e) => e.textContent),
  names: Array.from(document.querySelectorAll('.map-place-name')).map((e) => e.textContent),
}))

console.log(JSON.stringify(dom, null, 2))
await page.screenshot({ path: 'scripts/out/map-panel.png', fullPage: false })

if (errors.length) {
  console.log('PAGE ERRORS:')
  for (const e of errors) console.log(`  ${e}`)
} else {
  console.log('No page errors.')
}

await browser.close()
