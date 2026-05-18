// Phase 6 — Category C (renderer-pixel). Boots via `?test=1&assets=1`
// so the in-game ground renderer actually requests + composes LPC
// sprites for spawned NPCs. The assertion is on captured /lpc/ HTTP
// responses — pixels via network, no canvas read.

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
// Wait for the world to spawn (debug handle ready), let one Pixi frame
// commit so the ground renderer asks composeSheet for its first NPC
// batch, then drain every in-flight sprite job. No fixed waitForTimeout.
await page.waitForFunction(
  () => typeof window.__uclife__?.awaitAssetsReady === 'function'
    && typeof window.__uclife__?.pendingAssetJobs === 'function'
    && typeof window.__uclife__?.countByKind === 'function',
  null,
  { timeout: BOOT_READY_TIMEOUT_MS },
)
// Two raf yields → guaranteed Pixi ticker ran at least once, scheduling
// the first composeSheet batch; awaitAssetsReady then drains it.
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
await page.evaluate(
  (t) => window.__uclife__.awaitAssetsReady({ timeoutMs: t }),
  ASSET_DRAIN_TIMEOUT_MS,
)

await page.screenshot({ path: join(outDir, 'sprite-ingame.png'), fullPage: false })
await browser.close()

const okCount = lpcRequests.filter((r) => r.status === 200).length
const failCount = lpcRequests.filter((r) => r.status !== 200).length
console.log(`--- LPC ingame smoke test ---`)
console.log(`/lpc/ requests: ${lpcRequests.length} (${okCount} ok, ${failCount} fail)`)
console.log('failing paths:')
for (const r of lpcRequests) {
  if (r.status !== 200) console.log(`  ${r.status} ${r.url}`)
}
assert.equal(errors.length, 0,
  `page error(s) during test:\n${errors.map((e) => '  ' + e).join('\n')}`)
assert.ok(lpcRequests.length > 0,
  'no LPC requests — sprites never composed (ground renderer didn\'t tick)')
assert.equal(failCount, 0,
  `${failCount} sprite requests returned non-200`)

console.log('OK')
