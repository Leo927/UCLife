// Phase 6 — Category C (renderer-pixel). Boots via `?test=1&assets=1`
// so portrait cache + SvgQueue actually run; awaitAssetsReady() drains
// each preset switch deterministically (replaces the legacy 800+300ms
// waits). Preset switching is real Playwright input on the label.

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
const DOM_COMMIT_TIMEOUT_MS = 15_000
const PRESETS = ['default-female', 'default-male', 'preg', 'punk']
const MIN_SVG_DIM_PX = 50

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

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof window.uclifePortraitTester === 'function'
    && typeof window.__uclife__?.awaitAssetsReady === 'function',
  null,
  { timeout: BOOT_READY_TIMEOUT_MS },
)

await page.evaluate(() => window.uclifePortraitTester())
// The PortraitTester's React commit kicks off the cache load on mount.
// Wait for one art* SVG so the asset jobs have certainly registered,
// then drain the readiness barrier deterministically.
await page.waitForSelector('svg[class^="art"]', { timeout: DOM_COMMIT_TIMEOUT_MS })
await page.evaluate(
  (t) => window.__uclife__.awaitAssetsReady({ timeoutMs: t }),
  ASSET_DRAIN_TIMEOUT_MS,
)

const stats = await page.evaluate(() => {
  const containers = Array.from(document.querySelectorAll('div'))
    .filter((d) => {
      const cs = getComputedStyle(d)
      return cs.position === 'relative' && cs.overflow === 'hidden' && d.querySelector('svg')
    })
  const out = []
  for (const c of containers) {
    const cb = c.getBoundingClientRect()
    const svgs = Array.from(c.querySelectorAll('svg'))
    const styleEls = Array.from(c.querySelectorAll('style'))
    out.push({
      box: { w: Math.round(cb.width), h: Math.round(cb.height) },
      svgCount: svgs.length,
      styleCount: styleEls.length,
      svgBoxes: svgs.slice(0, 3).map((s) => {
        const r = s.getBoundingClientRect()
        return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top - cb.top), left: Math.round(r.left - cb.left) }
      }),
      anyOverflowing: svgs.some((s) => {
        const r = s.getBoundingClientRect()
        return r.right - cb.right > 5 || cb.left - r.left > 5 || r.bottom - cb.bottom > 5 || cb.top - r.top > 5
      }),
    })
  }
  return out
})

console.log('portrait container stats:', JSON.stringify(stats, null, 2))

await page.screenshot({ path: join(outDir, 'portrait-tester.png'), fullPage: false })
console.log(`screenshot: ${join(outDir, 'portrait-tester.png')}`)

for (const p of PRESETS) {
  await page.locator(`label`).filter({ hasText: p }).click({ force: true })
  // Each preset switch kicks off a fresh portrait re-render. Drain the
  // asset jobs that the new render registers — no fixed sleep.
  await page.evaluate(
    (t) => window.__uclife__.awaitAssetsReady({ timeoutMs: t }),
    ASSET_DRAIN_TIMEOUT_MS,
  )
  await page.screenshot({ path: join(outDir, `portrait-${p}.png`) })
  console.log(`screenshot: portrait-${p}.png`)
}

// FC's SvgQueue.output merges all layers with matching attributes into a
// single optimized SVG, so svgCount >= 1 (not one per layer).
const renderedContainer = stats.find((c) => c.svgCount > 0)
assert.ok(renderedContainer, 'no portrait container with an svg child found')
assert.ok(renderedContainer.svgCount >= 1,
  `expected svgCount >= 1, got ${renderedContainer.svgCount}`)
assert.ok(renderedContainer.styleCount >= 1,
  `expected styleCount >= 1, got ${renderedContainer.styleCount}`)
const firstSvg = renderedContainer.svgBoxes[0]
assert.ok(firstSvg, 'first svg bounding box missing')
assert.ok(firstSvg.w > MIN_SVG_DIM_PX && firstSvg.h > MIN_SVG_DIM_PX,
  `first svg too small (${firstSvg.w}x${firstSvg.h}, want >${MIN_SVG_DIM_PX}px each side)`)
assert.equal(renderedContainer.anyOverflowing, false,
  'svg overflowed the relative+overflow:hidden container')
assert.equal(errors.length, 0,
  `page error(s) during test:\n${errors.map((e) => '  ' + e).join('\n')}`)

console.log('\nOK: portrait rendered inside container.')

await browser.close()
