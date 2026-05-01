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

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)

await page.evaluate(() => window.uclifePortraitTester())
await page.waitForTimeout(300)

// Wait for the placeholder ('加载头像…') to be replaced by an actual SVG —
// the cache load is async (~5.6 MB gzipped) so first paint can take a moment.
const portraitDiv = page.locator('div').filter({ has: page.locator('svg') }).first()
try {
  await portraitDiv.waitFor({ state: 'visible', timeout: 15_000 })
} catch (e) {
  errors.push(`timeout waiting for SVG to appear: ${e.message}`)
}

// Take stats snapshot of the default render first, before cycling presets
// (avoids a race where mid-cycle re-render leaves the container empty for a
// frame).
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
        // 5px slack for browser rounding.
        return r.right - cb.right > 5 || cb.left - r.left > 5 || r.bottom - cb.bottom > 5 || cb.top - r.top > 5
      }),
    })
  }
  return out
})

console.log('portrait container stats:', JSON.stringify(stats, null, 2))

await page.screenshot({ path: join(outDir, 'portrait-tester.png'), fullPage: false })
console.log(`screenshot: ${join(outDir, 'portrait-tester.png')}`)

// Click the label text (not the input) — clicking the radio input with
// force:true bypasses Playwright's actionability check but doesn't always
// trigger React's onChange when the input is occluded by sibling SVG
// pointer-events.
const presets = ['default-female', 'default-male', 'preg', 'punk']
for (const p of presets) {
  await page.locator(`label`).filter({ hasText: p }).click({ force: true })
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(outDir, `portrait-${p}.png`) })
  console.log(`screenshot: portrait-${p}.png`)
}

if (errors.length) {
  console.log('\nERRORS:')
  errors.forEach((e) => console.log('  ' + e))
}

// FC's SvgQueue.output merges all layers with matching attributes into a
// single optimized SVG, so svgCount >= 1 (not one per layer).
const renderedContainer = stats.find((c) => c.svgCount > 0)
const firstSvg = renderedContainer?.svgBoxes[0]
const ok = !!renderedContainer
  && renderedContainer.svgCount >= 1
  && renderedContainer.styleCount >= 1
  && !!firstSvg
  && firstSvg.w > 50 && firstSvg.h > 50
  && !renderedContainer.anyOverflowing
  && errors.length === 0

console.log(ok ? '\nOK: portrait rendered inside container.' : '\nFAIL.')
if (!ok) process.exitCode = 1

await browser.close()
