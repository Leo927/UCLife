// Boot smoke. Across two viewports (desktop + phone) verify the page boots
// cleanly, exposes __uclife__ with the canonical handles, and the campaign
// world finished procgen with a player + buildings + roads + flight hubs.
// Status panel toggle is exercised via the UI store, not a DOM click —
// the click path is covered by check-systemmenu / check-portrait-modals.

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const url = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'

await mkdir('scripts/out', { recursive: true })

const REQUIRED_HANDLES = [
  'world',
  'useScene',
  'useClock',
  'playerSnapshot',
  'countByKind',
  'flightHubCount',
  'saveGame',
  'loadGame',
]

const browser = await chromium.launch()

async function probe(label, viewport) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()

  const errors = []
  page.on('pageerror', (err) => errors.push(`${err.name}: ${err.message}`))
  page.on('requestfailed', (req) => errors.push(`REQ FAIL ${req.url()} ${req.failure()?.errorText}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    (names) => {
      const u = globalThis.__uclife__
      if (!u || typeof u !== 'object') return false
      if (typeof globalThis.uclifeUI?.getState !== 'function') return false
      return names.every((n) => n in u)
    },
    REQUIRED_HANDLES,
    { timeout: 30_000 },
  )

  const snap = await page.evaluate(() => {
    const u = globalThis.__uclife__
    return {
      activeScene: u.useScene.getState().activeId,
      player: u.playerSnapshot(),
      counts: u.countByKind(),
      hubs: u.flightHubCount(),
      title: document.title,
    }
  })

  await page.screenshot({ path: `scripts/out/boot-${label}.png`, fullPage: false })

  // Open + close the status panel via the UI store. Smoke value: if
  // store wiring is broken at boot the panel never renders, which the
  // status-panel handle below would also miss.
  await page.evaluate(() => globalThis.uclifeUI.getState().setStatus(true))
  await page.waitForFunction(() => !!document.querySelector('.status-panel'))
  const statusOpen = await page.evaluate(() => globalThis.uclifeUI.getState().statusOpen)
  await page.evaluate(() => globalThis.uclifeUI.getState().setStatus(false))
  await page.waitForFunction(() => !document.querySelector('.status-panel'))

  await ctx.close()

  return { label, viewport, snap, statusOpen, errors }
}

const results = []
results.push(await probe('desktop', { width: 1280, height: 800 }))
results.push(await probe('phone', { width: 390, height: 844 }))

const failures = []
for (const r of results) {
  console.log(`\n=== ${r.label} (${r.viewport.width}x${r.viewport.height}) ===`)
  console.log(JSON.stringify(r.snap, null, 2))
  if (r.errors.length) {
    console.log('ERRORS:')
    r.errors.forEach((e) => console.log('  ' + e))
    failures.push(`${r.label}: ${r.errors.length} page error(s)`)
  }
  if (!r.snap.player) failures.push(`${r.label}: playerSnapshot returned null — no player spawned`)
  if (r.snap.activeScene !== 'vonBraunCity') {
    failures.push(`${r.label}: activeScene='${r.snap.activeScene}', expected vonBraunCity`)
  }
  if ((r.snap.counts?.buildings ?? 0) <= 0) failures.push(`${r.label}: buildings=${r.snap.counts?.buildings} — procgen produced no buildings`)
  if ((r.snap.counts?.roads ?? 0) <= 0) failures.push(`${r.label}: roads=${r.snap.counts?.roads} — procgen produced no roads`)
  if ((r.snap.hubs ?? 0) <= 0) failures.push(`${r.label}: flightHubCount=${r.snap.hubs} — no airports placed`)
  if (!r.statusOpen) failures.push(`${r.label}: setStatus(true) did not flip uiStore.statusOpen`)
}

await browser.close()

if (failures.length) {
  console.log('\nFAIL:')
  failures.forEach((f) => console.log('  ' + f))
  process.exit(1)
}
console.log('\nOK: boot smoke passed.')
