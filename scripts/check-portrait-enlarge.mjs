// Phase 6 — Category C (renderer-pixel). Boots via `?test=1&assets=1`
// so the StatusPanel portrait actually composites and the enlarge modal
// mounts a 400x560 SVG. Real Playwright input (mouse click + Escape).

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
const DOM_COMMIT_TIMEOUT_MS = 10_000
const ESC_COMMIT_TIMEOUT_MS = 5_000

const SMALL_PORTRAIT_W = 96
const SMALL_PORTRAIT_H = 128
const ENLARGED_PORTRAIT_W = 400
const ENLARGED_PORTRAIT_H = 560

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
  () => typeof window.uclifeUI?.getState === 'function'
    && typeof window.__uclife__?.awaitAssetsReady === 'function',
  null,
  { timeout: BOOT_READY_TIMEOUT_MS },
)

await page.evaluate(() => window.uclifeUI.getState().setStatus(true))
// First portrait cache load happens here — drain it deterministically,
// then wait for the rendered SVG to commit to the DOM (the enlarge click
// targets the portrait's bounding box).
await page.evaluate(
  (t) => window.__uclife__.awaitAssetsReady({ timeoutMs: t }),
  ASSET_DRAIN_TIMEOUT_MS,
)
await page.waitForFunction(
  () => !!document.querySelector('svg[class^="art"]'),
  null,
  { timeout: DOM_COMMIT_TIMEOUT_MS },
)

async function findPortraitBoxes() {
  return await page.evaluate(() => {
    const containers = Array.from(document.querySelectorAll('div'))
      .filter((d) => {
        const cs = getComputedStyle(d)
        return cs.position === 'relative' && cs.overflow === 'hidden' && d.querySelector('svg.art1, svg.art2, svg.art3, svg.art4, svg.art5, svg.art6, svg.art7, svg.art8, svg.art9, svg.art10')
      })
    return containers.map((c) => {
      const r = c.getBoundingClientRect()
      const cs = getComputedStyle(c)
      return { w: Math.round(r.width), h: Math.round(r.height), cursor: cs.cursor, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
    })
  })
}

const beforeClick = await findPortraitBoxes()
console.log('before click:', JSON.stringify(beforeClick))
await page.screenshot({ path: join(outDir, 'enlarge-before.png') })

const playerBox = beforeClick.find((b) => b.w === SMALL_PORTRAIT_W && b.h === SMALL_PORTRAIT_H)
assert.ok(playerBox,
  `player portrait (${SMALL_PORTRAIT_W}x${SMALL_PORTRAIT_H}) not found in StatusPanel; got ${JSON.stringify(beforeClick)}`)
assert.equal(playerBox.cursor, 'zoom-in',
  `player portrait cursor expected 'zoom-in', got '${playerBox.cursor}'`)

await page.mouse.click(playerBox.x, playerBox.y)
// The enlarged modal is a fresh Portrait mount — wait for the store flip,
// every asset job to drain, then the 400x560 SVG to actually commit.
await page.waitForFunction(
  () => window.uclifeUI.getState().enlargedPortrait !== null,
  null,
  { timeout: DOM_COMMIT_TIMEOUT_MS },
)
await page.evaluate(
  (t) => window.__uclife__.awaitAssetsReady({ timeoutMs: t }),
  ASSET_DRAIN_TIMEOUT_MS,
)
await page.waitForFunction(
  ({ w, h }) => {
    const containers = Array.from(document.querySelectorAll('div'))
    return containers.some((d) => {
      if (!d.querySelector('svg[class^="art"]')) return false
      const r = d.getBoundingClientRect()
      return Math.round(r.width) === w && Math.round(r.height) === h
    })
  },
  { w: ENLARGED_PORTRAIT_W, h: ENLARGED_PORTRAIT_H },
  { timeout: DOM_COMMIT_TIMEOUT_MS },
)

const afterClick = await findPortraitBoxes()
console.log('after click:', JSON.stringify(afterClick))
await page.screenshot({ path: join(outDir, 'enlarge-after.png') })

const enlarged = afterClick.find((b) => b.w === ENLARGED_PORTRAIT_W && b.h === ENLARGED_PORTRAIT_H)
assert.ok(enlarged,
  `enlarged portrait (${ENLARGED_PORTRAIT_W}x${ENLARGED_PORTRAIT_H}) did not appear after click; got ${JSON.stringify(afterClick)}`)

const storeAfterClick = await page.evaluate(() => window.uclifeUI.getState().enlargedPortrait)
assert.notEqual(storeAfterClick, null,
  'uiStore.enlargedPortrait remained null after click')

await page.keyboard.press('Escape')
// Wait deterministically for the store to flip + the enlarged modal SVG
// to unmount. waitForFunction here checks DOM-mount state (allowed),
// not sim state, so the frozen clock doesn't apply.
await page.waitForFunction(
  ({ w, h }) => {
    if (window.uclifeUI.getState().enlargedPortrait !== null) return false
    const containers = Array.from(document.querySelectorAll('div'))
    return !containers.some((d) => {
      if (!d.querySelector('svg[class^="art"]')) return false
      const r = d.getBoundingClientRect()
      return Math.round(r.width) === w && Math.round(r.height) === h
    })
  },
  { w: ENLARGED_PORTRAIT_W, h: ENLARGED_PORTRAIT_H },
  { timeout: ESC_COMMIT_TIMEOUT_MS },
)
const storeAfterEsc = await page.evaluate(() => window.uclifeUI.getState().enlargedPortrait)
assert.equal(storeAfterEsc, null, 'Escape did not close the portrait modal')

const afterEsc = await findPortraitBoxes()
console.log('after esc:', JSON.stringify(afterEsc))
const stillEnlarged = afterEsc.find((b) => b.w === ENLARGED_PORTRAIT_W && b.h === ENLARGED_PORTRAIT_H)
assert.equal(stillEnlarged, undefined, 'enlarged portrait still present after Escape')

assert.equal(errors.length, 0,
  `page error(s) during test:\n${errors.map((e) => '  ' + e).join('\n')}`)

console.log('\nOK: portrait click-to-enlarge works end-to-end.')

await browser.close()
