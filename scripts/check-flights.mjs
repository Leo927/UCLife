// Trait-identity quirks with dynamic imports under Vite mean we can't
// reliably drive the full transition (player teleport + clock advance) from
// outside the running app — that path is exercised by manual playthrough.

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const url = process.argv[2] ?? 'http://localhost:5173/'
await mkdir('scripts/out', { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (err) => errors.push(`${err.name}: ${err.message}`))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

await page.evaluate(() => window.uclifeUI.getState().setMap(true))
await page.waitForTimeout(300)

const mapNames = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.map-place-name')).map((e) => e.textContent),
)
console.log('Map place names:', mapNames)

const expectedPlaces = ['冯·布劳恩航天港', '祖姆市 · Side 3 共和国首府', '祖姆市航天港']
const allPresent = expectedPlaces.every((p) => mapNames.includes(p))
console.log(allPresent ? 'PASS · all 3 new places on map' : 'FAIL · missing place(s)')

await page.screenshot({ path: 'scripts/out/flight-map.png', fullPage: false })
await page.evaluate(() => window.uclifeUI.getState().setMap(false))

await page.evaluate(() => window.uclifeUI.getState().openFlight('startTownAirport'))
await page.waitForTimeout(300)

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
console.log('Start town airport modal:')
console.log(JSON.stringify(startModal, null, 2))
await page.screenshot({ path: 'scripts/out/flight-modal-starttown.png', fullPage: false })

const startOk =
  startModal.headerH2 === '售票处 · 冯·布劳恩航天港' &&
  startModal.rows.length === 1 &&
  startModal.rows[0].name === '祖姆市航天港' &&
  startModal.rows[0].desc.some((d) => d?.includes('航程 6 小时') && d.includes('¥800')) &&
  startModal.rows[0].disabled === true &&  // player starts with ¥30 < ¥800 fare
  startModal.rows[0].btn === '钱不够'
console.log(startOk ? 'PASS · start town modal correct' : 'FAIL · start town modal mismatch')

await page.evaluate(() => window.uclifeUI.getState().closeFlight())
await page.waitForTimeout(200)

await page.evaluate(() => window.uclifeUI.getState().openFlight('zumCityAirport'))
await page.waitForTimeout(300)

const zumModal = await page.evaluate(() => {
  const headerH2 = document.querySelector('.status-panel .status-header h2')?.textContent ?? null
  const rows = Array.from(document.querySelectorAll('.transit-terminal-row')).map((r) => ({
    name: r.querySelector('.transit-terminal-name')?.textContent ?? null,
    btn: r.querySelector('.transit-terminal-go')?.textContent ?? null,
  }))
  return { headerH2, rows }
})
console.log('Zum City airport modal:')
console.log(JSON.stringify(zumModal, null, 2))

const zumOk =
  zumModal.headerH2 === '售票处 · 祖姆市航天港' &&
  zumModal.rows.length === 1 &&
  zumModal.rows[0].name === '冯·布劳恩航天港'
console.log(zumOk ? 'PASS · zum city modal correct' : 'FAIL · zum city modal mismatch')

await page.evaluate(() => window.uclifeUI.getState().closeFlight())

if (errors.length) {
  console.log('PAGE ERRORS:')
  for (const e of errors) console.log(`  ${e}`)
} else {
  console.log('No page errors.')
}

await browser.close()
