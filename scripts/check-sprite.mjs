// Phase 6 — Category C (renderer-pixel). Boots via `?test=1&assets=1`
// so composeSheet actually fetches LPC layers + recolors them; pixel
// count + LPC request capture both assert on real asset output.

import { strict as assert } from 'node:assert'
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, 'out')
await mkdir(outDir, { recursive: true })

const BOOT_READY_TIMEOUT_MS = 30_000
const ASSET_DRAIN_TIMEOUT_MS = 30_000
const CANVAS_TIMEOUT_MS = 10_000

const SHEET_W = 832
const SHEET_H = 256
const MIN_OPAQUE_PIXELS = 1000
const TESTER_OVERLAY_Z_INDEX = '9999'

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1&assets=1', baseUrl).toString()

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

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof window.uclifeSpriteTester === 'function'
    && typeof window.__uclife__?.awaitAssetsReady === 'function',
  null,
  { timeout: BOOT_READY_TIMEOUT_MS },
)

await page.evaluate(() => window.uclifeSpriteTester())
// composeSheet registers asset jobs ('sprite:img:...', 'sprite:sheet:...').
// Wait for the overlay canvas to mount, then drain the barrier.
await page.waitForSelector(
  `div[style*="z-index: ${TESTER_OVERLAY_Z_INDEX}"] canvas`,
  { timeout: CANVAS_TIMEOUT_MS },
)
await page.evaluate(
  (t) => window.__uclife__.awaitAssetsReady({ timeoutMs: t }),
  ASSET_DRAIN_TIMEOUT_MS,
)

// Real Playwright input: change the name + gender. selectOption drives
// React's synthetic onChange path; dispatchEvent shortcuts are an
// anti-pattern banned by the playbook.
await page.fill(`div[style*="z-index: ${TESTER_OVERLAY_Z_INDEX}"] input[type=text]`, 'Wei Tanaka')
const genderSelect = page.locator(
  `div[style*="z-index: ${TESTER_OVERLAY_Z_INDEX}"] label`,
).filter({ hasText: 'gender:' }).locator('select')
await genderSelect.selectOption('male')
// Sex switch kicks off a fresh composeSheet — drain again before probe.
await page.evaluate(
  (t) => window.__uclife__.awaitAssetsReady({ timeoutMs: t }),
  ASSET_DRAIN_TIMEOUT_MS,
)

const stats = await page.evaluate((zIndex) => {
  const overlay = Array.from(document.querySelectorAll('div')).find(
    (d) => getComputedStyle(d).zIndex === zIndex,
  )
  const canvas = overlay?.querySelector('canvas')
  if (!canvas) return { found: false }
  const ctx = canvas.getContext('2d')
  if (!ctx) return { found: true, ctx: false }
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  let opaque = 0
  for (let i = 3; i < img.length; i += 4) {
    if (img[i] > 0) opaque++
  }
  return {
    found: true,
    ctx: true,
    width: canvas.width,
    height: canvas.height,
    opaquePixels: opaque,
    totalPixels: img.length / 4,
  }
}, TESTER_OVERLAY_Z_INDEX)

await page.screenshot({ path: join(outDir, 'sprite-tester.png'), fullPage: false })

await browser.close()

console.log('--- LPC sprite smoke test ---')
console.log(`canvas: ${JSON.stringify(stats)}`)
const okCount = lpcRequests.filter((r) => r.status === 200).length
const failCount = lpcRequests.filter((r) => r.status !== 200).length
console.log(`lpc requests: ${lpcRequests.length} (${okCount} ok, ${failCount} fail)`)
for (const r of lpcRequests) {
  console.log(`  ${r.status} ${r.url}`)
}
assert.equal(errors.length, 0,
  `page error(s) during test:\n${errors.map((e) => '  ' + e).join('\n')}`)
assert.ok(stats.found, 'no canvas found in sprite tester overlay')
assert.ok(stats.ctx, 'canvas has no 2D context')
assert.equal(stats.width, SHEET_W,
  `expected ${SHEET_W}x${SHEET_H} sheet, got ${stats.width}x${stats.height}`)
assert.equal(stats.height, SHEET_H,
  `expected ${SHEET_W}x${SHEET_H} sheet, got ${stats.width}x${stats.height}`)
assert.ok(stats.opaquePixels >= MIN_OPAQUE_PIXELS,
  `only ${stats.opaquePixels} opaque pixels (want >= ${MIN_OPAQUE_PIXELS}) — likely empty sheet`)
assert.ok(lpcRequests.length > 0,
  'no /lpc/ requests captured — middleware not exercised')
assert.equal(failCount, 0,
  `${failCount} sprite requests returned non-200`)

console.log('OK')
