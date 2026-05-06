// Smoke test: transit-terminal placements after the procgen + airport-embed
// rework. Confirms each scene has the expected terminals registered (with
// pixel coords) and that the in-world Transit entities exist.

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const url = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
await mkdir('scripts/out', { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const page = await ctx.newPage()

const errors = []
const failures = []
page.on('pageerror', (err) => errors.push(`${err.name}: ${err.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

// Pull terminal metadata + runtime placement registry contents through
// __uclife__.listTransitTerminals — dynamic imports inside playwright
// load a different trait-module instance, so use the app-side helper
// which shares identity with the running world.
const list = await page.evaluate(() => window.__uclife__.listTransitTerminals())

console.log('Transit terminals (from app-side helper):')
console.log(JSON.stringify(list, null, 2))

const probe = { vonBraunCity: { declared: [] }, zumCity: { declared: [] } }
for (const t of list) {
  if (!probe[t.sceneId]) continue
  probe[t.sceneId].declared.push({
    id: t.id, placement: t.placement, live: t.live, registered: t.registered,
  })
}

// Expectations:
//   vonBraunCity: 3 terminals, all live + registered
//     - vonBraunCityPlaza      (placement: building, central commercial district)
//     - vonBraunCityAirportStop(placement: airport)
//     - aeIndustrialStop    (placement: building, AE industrial district)
//   zumCity:   2 terminals, all live + registered
//     - zumCityPlaza        (placement: building)
//     - zumCityAirportStop  (placement: airport)
const expect = {
  vonBraunCity: ['vonBraunCityPlaza', 'vonBraunCityAirportStop', 'aeIndustrialStop'],
  zumCity:   ['zumCityPlaza', 'zumCityAirportStop'],
}

for (const [sceneId, ids] of Object.entries(expect)) {
  const got = probe[sceneId]
  const declaredIds = got.declared.map((d) => d.id).sort()
  const expectIds = [...ids].sort()
  if (JSON.stringify(declaredIds) !== JSON.stringify(expectIds)) {
    failures.push(`${sceneId}: terminal id mismatch — got ${JSON.stringify(declaredIds)}, want ${JSON.stringify(expectIds)}`)
  }
  for (const d of got.declared) {
    if (!d.live)       failures.push(`${sceneId}/${d.id}: no live Transit entity`)
    if (!d.registered) failures.push(`${sceneId}/${d.id}: missing transitPlacements entry`)
  }
}

// Now drive the UI: open the central terminal's transit modal and check
// it lists all in-scene destinations.
await page.evaluate(() => window.uclifeUI.getState().openTransit('vonBraunCityPlaza'))
await page.waitForTimeout(300)

const modal = await page.evaluate(() => {
  const headerH2 = document.querySelector('.status-panel .status-header h2')?.textContent ?? null
  const rows = Array.from(document.querySelectorAll('.transit-terminal-row')).map((r) => ({
    name: r.querySelector('.transit-terminal-name')?.textContent ?? null,
    btn: r.querySelector('.transit-terminal-go')?.textContent ?? null,
  }))
  return { headerH2, rows }
})
console.log('vonBraunCityPlaza modal:')
console.log(JSON.stringify(modal, null, 2))

// AmbitionPanel may sit on top of the transit panel on first launch (it's
// modal-stacked); the rows query crosses both panels, so we just check
// transit-row content rather than the header. The AmbitionPanel issue is
// pre-existing and out of scope for transit testing.
const wantNames = ['市中心广场站', '冯·布劳恩航天港站', 'AE 工业区站']
// Strip the trailing "所在地" badge if present (the source row appends it).
const gotNames = modal.rows.map((r) => (r.name ?? '').replace('所在地', '').trim())
for (const want of wantNames) {
  if (!gotNames.includes(want)) failures.push(`vonBraunCityPlaza modal missing terminal "${want}"`)
}

await page.screenshot({ path: 'scripts/out/transit-modal-starttown.png', fullPage: false })

await page.evaluate(() => window.uclifeUI.getState().closeTransit())

if (errors.length) {
  console.log('PAGE ERRORS:')
  for (const e of errors) console.log(`  ${e}`)
}

await browser.close()

if (failures.length || errors.length) {
  console.log(`\nFAILED: ${failures.length} assertion(s), ${errors.length} page error(s).`)
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
} else {
  console.log('\nPASS · transit terminals correctly placed in both scenes')
}
