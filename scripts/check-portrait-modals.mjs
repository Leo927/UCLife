// Phase 6 — Category C (renderer-pixel). Boots via `?test=1&assets=1` so
// every conversation surface composites its portrait through the real
// pipeline. Each surface uses window.uclifePinClerk(specId) (registered
// in src/render/portrait/__debug__/portraitFixtures.ts) to synthetically
// pin an NPC to the target workstation in `working` state — sidestepping
// the BT so we don't wait for the game to schedule shifts.

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
const CLERK_SPEC_IDS = ['city_hr_clerk', 'realtor', 'ae_director']

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
  () => typeof window.__uclife__?.fillJobVacancies === 'function'
    && typeof window.__uclife__?.awaitAssetsReady === 'function'
    && typeof window.uclifePinClerk === 'function',
  null,
  { timeout: BOOT_READY_TIMEOUT_MS },
)
// Guarantee deterministic workers for every clerk specId used in this test,
// regardless of procgen building placement outcomes.
await page.evaluate(
  (ids) => window.__uclife__.fillJobVacancies(ids),
  CLERK_SPEC_IDS,
)
// Drain any boot-time asset jobs before opening dialogs.
await page.evaluate(
  (t) => window.__uclife__.awaitAssetsReady({ timeoutMs: t }),
  ASSET_DRAIN_TIMEOUT_MS,
)

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
  assert.ok(ok, `fixture failed for ${name}`)
  // Two-step deterministic wait: the asset cache finishes loading, then
  // React commits the Portrait useEffect that mounts an art* SVG into
  // the DOM. The probe filters on those SVGs, so we wait for at least
  // one before snapshotting.
  await page.evaluate(
    (t) => window.__uclife__.awaitAssetsReady({ timeoutMs: t }),
    ASSET_DRAIN_TIMEOUT_MS,
  )
  await page.waitForFunction(
    () => !!document.querySelector('svg[class^="art"]'),
    null,
    { timeout: DOM_COMMIT_TIMEOUT_MS },
  )
  await page.screenshot({ path: join(outDir, screenshotName) })
  const stats = await probe()
  console.log(`${name}:`, JSON.stringify(stats))
  await page.evaluate(() => window.uclifeUI.getState().setDialogNPC(null))
  // Wait for the dialog to actually unmount before opening the next one
  // (probe() looks for art* SVGs, which only the dialog renders).
  await page.waitForFunction(
    () => window.uclifeUI.getState().dialogNPC === null
      && !document.querySelector('svg[class^="art"]'),
    null,
    { timeout: DOM_COMMIT_TIMEOUT_MS },
  )
  return stats
}

const results = {}

await page.evaluate(() => window.uclifeUI.getState().setStatus(true))
// First portrait cache load happens here — drain it, then wait for the
// StatusPanel's portrait useEffect to commit at least one art* SVG.
await page.evaluate(
  (t) => window.__uclife__.awaitAssetsReady({ timeoutMs: t }),
  ASSET_DRAIN_TIMEOUT_MS,
)
await page.waitForFunction(
  () => !!document.querySelector('svg[class^="art"]'),
  null,
  { timeout: DOM_COMMIT_TIMEOUT_MS },
)
await page.screenshot({ path: join(outDir, 'modal-status.png') })
results.status = await probe()
console.log('status:', JSON.stringify(results.status))
await page.evaluate(() => window.uclifeUI.getState().setStatus(false))
await page.waitForFunction(
  () => window.uclifeUI.getState().statusOpen === false
    && !document.querySelector('svg[class^="art"]'),
  null,
  { timeout: DOM_COMMIT_TIMEOUT_MS },
)

results.hr = await runSurface('hr', () => openClerkDialogPinned('city_hr_clerk'), 'modal-hr.png')
results.realtor = await runSurface('realtor', () => openClerkDialogPinned('realtor'), 'modal-realtor.png')
results.ae = await runSurface('ae', () => openClerkDialogPinned('ae_director'), 'modal-ae.png')

const surfaces = ['status', 'hr', 'realtor', 'ae']
for (const s of surfaces) {
  const r = results[s] ?? []
  const found = r.find((c) => c.svgCount > 0 && !c.overflow)
  console.log(`  ${s}: ${found ? `OK (${found.box.w}x${found.box.h}, svg=${found.svgCount})` : 'FAIL (no contained svg)'}`)
  assert.ok(found, `${s} portrait container has no contained svg`)
}

assert.equal(errors.length, 0,
  `page error(s) during test:\n${errors.map((e) => '  ' + e).join('\n')}`)

console.log('\nOK: all four conversation surfaces render contained portraits.')

await browser.close()
