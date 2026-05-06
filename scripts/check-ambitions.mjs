import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const url = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'

await mkdir('scripts/out', { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

const failures = []
const fail = (msg) => failures.push(msg)

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!globalThis.__uclife__?.getAmbitions, null, { timeout: 30000 })

// ── Step 1: panel must NOT auto-open; player should already have a default ──
const overlayCount = await page.locator('.status-overlay').count()
if (overlayCount !== 0) fail(`no overlay should auto-open at start, got ${overlayCount}`)

const initial = await page.evaluate(() => globalThis.__uclife__.getAmbitions())
if (!initial?.active?.length) fail('player should boot with a pre-seeded ambition slot')

// ── Step 2: replace the placeholder with mw_pilot + lazlos_owner ──
await page.evaluate(() => {
  return globalThis.__uclife__.pickAmbitions(['mw_pilot', 'lazlos_owner'])
})

// ── Step 3: pause, then mutate stats so mw_pilot stage 1 thresholds clear ──
await page.locator('.hud-controls button', { hasText: '暂停' }).click().catch(() => {})

await page.evaluate(() => {
  globalThis.__uclife__.setPlayerStat('attributes.reflex', 35)
  globalThis.__uclife__.setPlayerStat('skills.athletics', 600)
})

// ── Step 4: advance one game-day + force a tick ─────────────────────────
await page.evaluate(() => {
  globalThis.__uclife__.advanceGameDays(1)
  globalThis.__uclife__.runAmbitionsTick()
})

// ── Step 5: assert title + log + active[0].currentStage ─────────────────
const after = await page.evaluate(() => {
  return {
    amb: globalThis.__uclife__.getAmbitions(),
    log: globalThis.__uclife__.getEventLog(),
  }
})

const expectedTitle = '机工预备生'
if (after.amb?.title !== expectedTitle) {
  fail(`expected Character.title === '${expectedTitle}', got '${after.amb?.title}'`)
}

const mwSlot = after.amb?.active?.find((s) => s.id === 'mw_pilot')
if (!mwSlot) fail('mw_pilot slot missing from active list')
else if (mwSlot.currentStage !== 1) {
  fail(`expected mw_pilot.currentStage === 1, got ${mwSlot.currentStage}`)
}

const stageLog = after.log.find((e) => e.textZh.includes('体检合格'))
if (!stageLog) fail('expected stage-1 log line not found in event log')

// ── Step 6: open panel manually, screenshot view mode ───────────────────
await page.evaluate(() => { window.uclifeUI.getState().setAmbitions(true) })
await page.waitForFunction(() => !!document.querySelector('.status-panel'))
await page.screenshot({ path: 'scripts/out/ambition-view.png', fullPage: false })

const titleEl = await page.locator('[data-player-title]').first().textContent().catch(() => null)
if (!titleEl || !titleEl.includes(expectedTitle)) {
  await page.evaluate(() => { window.uclifeUI.getState().setAmbitions(false); window.uclifeUI.getState().setStatus(true) })
  await page.waitForFunction(() => !!document.querySelector('.status-panel'))
  const t2 = await page.locator('[data-player-title]').first().textContent().catch(() => null)
  if (!t2 || !t2.includes(expectedTitle)) {
    fail(`StatusPanel title element does not contain '${expectedTitle}': got '${t2}'`)
  }
  await page.evaluate(() => { window.uclifeUI.getState().setStatus(false); window.uclifeUI.getState().setAmbitions(true) })
}

// ── Step 7: save → reload → load → assert persistence ──────────────────
await page.evaluate(() => { window.uclifeUI.getState().setAmbitions(false) })

await page.evaluate(async () => { await globalThis.__uclife__.saveGame(1) })

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!globalThis.__uclife__?.getAmbitions, null, { timeout: 30000 })

await page.evaluate(async () => { await globalThis.__uclife__.loadGame(1) })
await page.waitForFunction(() => {
  const a = globalThis.__uclife__?.getAmbitions()
  return a?.active?.some((s) => s.id === 'mw_pilot' && s.currentStage === 1)
}, null, { timeout: 10000 })

const restored = await page.evaluate(() => globalThis.__uclife__.getAmbitions())
const mwSlot2 = restored?.active?.find((s) => s.id === 'mw_pilot')
if (!mwSlot2) fail('after reload, mw_pilot slot missing from active list')
else if (mwSlot2.currentStage !== 1) {
  fail(`after reload, expected mw_pilot.currentStage === 1, got ${mwSlot2.currentStage}`)
}
if (restored?.title !== expectedTitle) {
  fail(`after reload, expected Character.title === '${expectedTitle}', got '${restored?.title}'`)
}

// ── Report ────────────────────────────────────────────────────────────────
if (errors.length) {
  console.log('\nERRORS:')
  errors.forEach((e) => console.log('  ' + e))
}
if (failures.length) {
  console.log('\nFAILURES:')
  failures.forEach((f) => console.log('  ' + f))
}

const ok = failures.length === 0 && errors.length === 0
console.log(ok ? '\nOK: ambitions round-trip passed.' : '\nFAIL: ambitions checks failed.')
if (!ok) process.exitCode = 1

await browser.close()
