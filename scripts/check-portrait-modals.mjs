// Each conversation surface uses window.uclifePinClerk(specId) (defined in
// src/render/portrait/__debug__/portraitFixtures.ts) to synthetically pin an
// NPC to the target workstation in `working` state. This sidesteps the BT —
// we don't wait for the game to schedule shifts; we force the world into the
// exact state the conversation extension demands.

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

async function probe() {
  return await page.evaluate(() => {
    const containers = Array.from(document.querySelectorAll('div'))
      .filter((d) => {
        const cs = getComputedStyle(d)
        return cs.position === 'relative' && cs.overflow === 'hidden' && d.querySelector('svg.art1, svg.art2, svg.art3, svg.art4, svg.art5, svg.art6, svg.art7, svg.art8, svg.art9, svg.art10')
      })
    const out = []
    for (const c of containers) {
      const cb = c.getBoundingClientRect()
      const svgs = Array.from(c.querySelectorAll('svg'))
      out.push({
        box: { w: Math.round(cb.width), h: Math.round(cb.height) },
        svgCount: svgs.length,
        svgBox: svgs[0] ? (() => { const r = svgs[0].getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } })() : null,
        overflow: svgs.some((s) => {
          const r = s.getBoundingClientRect()
          return r.right - cb.right > 5 || cb.left - r.left > 5 || r.bottom - cb.bottom > 5 || cb.top - r.top > 5
        }),
      })
    }
    return out
  })
}

async function openClerkDialogPinned(specId) {
  return await page.evaluate(({ specId }) => {
    const npc = window.uclifePinClerk?.(specId) ?? null
    if (!npc) return false
    window.uclifeUI.getState().setDialogNPC(npc)
    return true
  }, { specId })
}

async function runSurface(name, openFn, screenshotName) {
  const ok = await openFn()
  if (!ok) {
    errors.push(`fixture failed for ${name}`)
    return []
  }
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(outDir, screenshotName) })
  const stats = await probe()
  console.log(`${name}:`, JSON.stringify(stats))
  await page.evaluate(() => window.uclifeUI.getState().setDialogNPC(null))
  await page.waitForTimeout(200)
  return stats
}

const results = {}

await page.evaluate(() => window.uclifeUI.getState().setStatus(true))
await page.waitForTimeout(1500)  // first portrait cache load
await page.screenshot({ path: join(outDir, 'modal-status.png') })
results.status = await probe()
console.log('status:', JSON.stringify(results.status))
await page.evaluate(() => window.uclifeUI.getState().setStatus(false))
await page.waitForTimeout(200)

results.hr = await runSurface('hr', () => openClerkDialogPinned('city_hr_clerk'), 'modal-hr.png')
results.realtor = await runSurface('realtor', () => openClerkDialogPinned('realtor'), 'modal-realtor.png')
results.ae = await runSurface('ae', () => openClerkDialogPinned('ae_director'), 'modal-ae.png')

if (errors.length) {
  console.log('\nERRORS:')
  errors.forEach((e) => console.log('  ' + e))
}

const surfaces = ['status', 'hr', 'realtor', 'ae']
let ok = errors.length === 0
for (const s of surfaces) {
  const r = results[s] ?? []
  const found = r.find((c) => c.svgCount > 0 && !c.overflow)
  console.log(`  ${s}: ${found ? `OK (${found.box.w}x${found.box.h}, svg=${found.svgCount})` : 'FAIL (no contained svg)'}`)
  if (!found) ok = false
}

console.log(ok ? '\nOK: all four conversation surfaces render contained portraits.' : '\nFAIL.')
if (!ok) process.exitCode = 1

await browser.close()
