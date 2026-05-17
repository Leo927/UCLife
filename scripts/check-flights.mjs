// Map + flight-modal contents only — the actual scene-swap round-trip
// is exercised by check-scene-swap.
//
// Migrated to Phase 6 deterministic boot: ?test=1 freezes the clock,
// skips assets, and exposes __uclife_test__.step(). This test does no
// sim-time work — every `waitFor` is a DOM-mount race for React commits,
// which is allowed.

import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import { mkdir } from 'node:fs/promises'

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1', baseUrl).toString()

await mkdir('scripts/out', { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (err) => errors.push(`${err.name}: ${err.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.getGameState === 'function'
    && typeof window.uclifeUI?.getState === 'function',
  null,
  { timeout: 30_000 },
)

await page.evaluate(() => window.uclifeUI.getState().setMap(true))
await page.waitForSelector('.map-place-name', { timeout: 5_000 })

const mapNames = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.map-place-name')).map((e) => e.textContent),
)

const expectedDistricts = ['冯·布劳恩中心区', 'AE 工业区']
for (const d of expectedDistricts) {
  assert.ok(
    mapNames.includes(d),
    `vonBraunCity map should expose district "${d}"; got ${JSON.stringify(mapNames)}`,
  )
}

await page.screenshot({ path: 'scripts/out/flight-map.png', fullPage: false })
await page.evaluate(() => window.uclifeUI.getState().setMap(false))

await page.evaluate(() => window.uclifeUI.getState().openFlight('vonBraunCityAirport'))
await page.waitForSelector('.transit-terminal-row', { timeout: 5_000 })

const startModal = await page.evaluate(() => {
  const headerH2 = document.querySelector('.status-panel .status-header h2')?.textContent ?? null
  const rows = Array.from(document.querySelectorAll('.transit-terminal-row')).map((r) => ({
    name: r.querySelector('.transit-terminal-name')?.textContent ?? null,
    desc: Array.from(r.querySelectorAll('.transit-terminal-desc')).map((e) => e.textContent),
    btn: r.querySelector('.transit-terminal-go')?.textContent ?? null,
    disabled: r.querySelector('.transit-terminal-go')?.disabled ?? null,
  }))
  return { headerH2, rows }
})
await page.screenshot({ path: 'scripts/out/flight-modal-starttown.png', fullPage: false })

assert.equal(
  startModal.headerH2, '售票处 · 冯·布劳恩航天港',
  `Von Braun airport header should be "售票处 · 冯·布劳恩航天港"; got "${startModal.headerH2}"`,
)
assert.equal(
  startModal.rows.length, 1,
  `Von Braun airport should expose 1 transit row; got ${startModal.rows.length}`,
)
assert.equal(
  startModal.rows[0].name, '祖姆市航天港',
  `Von Braun row name should be "祖姆市航天港"; got "${startModal.rows[0].name}"`,
)
assert.ok(
  startModal.rows[0].desc.some((d) => d?.includes('航程 6 小时') && d.includes('¥800')),
  `Von Braun row desc should include "航程 6 小时" + "¥800"; got ${JSON.stringify(startModal.rows[0].desc)}`,
)
assert.equal(
  startModal.rows[0].disabled, true,
  `Von Braun fare button should be disabled at boot money <¥800; got disabled=${startModal.rows[0].disabled}`,
)
assert.equal(
  startModal.rows[0].btn, '钱不够',
  `Von Braun fare button label should be "钱不够"; got "${startModal.rows[0].btn}"`,
)

await page.evaluate(() => window.uclifeUI.getState().closeFlight())
await page.waitForFunction(() => window.uclifeUI.getState().flightHubId === null)

await page.evaluate(() => window.uclifeUI.getState().openFlight('zumCityAirport'))
await page.waitForSelector('.transit-terminal-row', { timeout: 5_000 })

const zumModal = await page.evaluate(() => {
  const headerH2 = document.querySelector('.status-panel .status-header h2')?.textContent ?? null
  const rows = Array.from(document.querySelectorAll('.transit-terminal-row')).map((r) => ({
    name: r.querySelector('.transit-terminal-name')?.textContent ?? null,
    btn: r.querySelector('.transit-terminal-go')?.textContent ?? null,
  }))
  return { headerH2, rows }
})

assert.equal(
  zumModal.headerH2, '售票处 · 祖姆市航天港',
  `Zum airport header should be "售票处 · 祖姆市航天港"; got "${zumModal.headerH2}"`,
)
assert.equal(
  zumModal.rows.length, 1,
  `Zum airport should expose 1 transit row; got ${zumModal.rows.length}`,
)
assert.equal(
  zumModal.rows[0].name, '冯·布劳恩航天港',
  `Zum row name should be "冯·布劳恩航天港"; got "${zumModal.rows[0].name}"`,
)

await page.evaluate(() => window.uclifeUI.getState().closeFlight())

assert.equal(
  errors.length, 0,
  `page error(s) during test:\n${errors.map((e) => '  ' + e).join('\n')}`,
)

await browser.close()

console.log('OK — check-flights:')
console.log(`  map districts: ${expectedDistricts.join(', ')}`)
console.log(`  Von Braun airport row: ${startModal.rows[0].name} (${startModal.rows[0].btn})`)
console.log(`  Zum City airport row: ${zumModal.rows[0].name}`)
