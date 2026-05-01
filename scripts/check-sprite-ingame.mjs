import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, 'out')
await mkdir(outDir, { recursive: true })

const url = process.argv[2] ?? 'http://localhost:5173/'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`pageerror ${e.name}: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

const lpcRequests = []
page.on('response', (r) => {
  const u = r.url()
  if (u.includes('/lpc/')) lpcRequests.push({ url: u, status: r.status() })
})

await page.goto(url, { waitUntil: 'networkidle' })
// Wait for the world to spawn and the sprite ticker to advance.
await page.waitForTimeout(3500)

await page.screenshot({ path: join(outDir, 'sprite-ingame.png'), fullPage: false })
await browser.close()

const ok = lpcRequests.filter((r) => r.status === 200).length
const fail = lpcRequests.filter((r) => r.status !== 200).length
console.log(`--- LPC ingame smoke test ---`)
console.log(`/lpc/ requests: ${lpcRequests.length} (${ok} ok, ${fail} fail)`)
console.log('failing paths:')
for (const r of lpcRequests) {
  if (r.status !== 200) console.log(`  ${r.status} ${r.url}`)
}
if (errors.length) {
  console.log(`errors:`)
  for (const e of errors) console.log(`  ${e}`)
  process.exit(1)
}
if (lpcRequests.length === 0) {
  console.log('FAIL: no LPC requests — sprites never composed')
  process.exit(1)
}
if (fail > 0) {
  console.log(`FAIL: ${fail} sprite requests returned non-200`)
  process.exit(1)
}
console.log('OK')
