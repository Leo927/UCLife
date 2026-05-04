import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { dismissAmbitionPicker } from './lib/dismissPicker.mjs'

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
await dismissAmbitionPicker(page)

await page.evaluate(() => window.uclifeUI.getState().setStatus(true))
await page.waitForTimeout(1500)  // first portrait cache load

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

const playerBox = beforeClick.find((b) => b.w === 96 && b.h === 128)
if (!playerBox) {
  errors.push('player portrait (96×128) not found in StatusPanel')
} else {
  if (playerBox.cursor !== 'zoom-in') {
    errors.push(`player portrait cursor expected 'zoom-in', got '${playerBox.cursor}'`)
  }
  await page.mouse.click(playerBox.x, playerBox.y)
  await page.waitForTimeout(800)
}

const afterClick = await findPortraitBoxes()
console.log('after click:', JSON.stringify(afterClick))
await page.screenshot({ path: join(outDir, 'enlarge-after.png') })

const enlarged = afterClick.find((b) => b.w === 400 && b.h === 560)
if (!enlarged) {
  errors.push('enlarged portrait (400×560) did not appear after click')
}

const storeAfterClick = await page.evaluate(() => {
  const ent = window.uclifeUI.getState().enlargedPortrait
  return ent !== null
})
if (!storeAfterClick) {
  errors.push('uiStore.enlargedPortrait remained null after click')
}

await page.keyboard.press('Escape')
await page.waitForTimeout(400)
const storeAfterEsc = await page.evaluate(() => window.uclifeUI.getState().enlargedPortrait)
if (storeAfterEsc !== null) {
  errors.push('Escape did not close the portrait modal')
}

const afterEsc = await findPortraitBoxes()
console.log('after esc:', JSON.stringify(afterEsc))
const stillEnlarged = afterEsc.find((b) => b.w === 400 && b.h === 560)
if (stillEnlarged) {
  errors.push('enlarged portrait still present after Escape')
}

if (errors.length) {
  console.log('\nERRORS:')
  errors.forEach((e) => console.log('  ' + e))
}

const ok = errors.length === 0
console.log(ok ? '\nOK: portrait click-to-enlarge works end-to-end.' : '\nFAIL.')
if (!ok) process.exitCode = 1

await browser.close()
