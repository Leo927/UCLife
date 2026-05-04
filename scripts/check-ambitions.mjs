import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { dismissAmbitionPicker } from './lib/dismissPicker.mjs'

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

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)

// ── Step 1: forced picker should have auto-opened ────────────────────────
const pickerOverlay = page.locator('.status-overlay[data-ambition-picker="forced"]')
try {
  await pickerOverlay.waitFor({ state: 'visible', timeout: 3000 })
} catch {
  fail('forced picker did not auto-open within 3s')
}
const closeBtnCount = await pickerOverlay.locator('.status-close').count()
if (closeBtnCount !== 0) fail('forced picker should not render a close button')
await page.screenshot({ path: 'scripts/out/ambition-picker.png', fullPage: false })

// ── Step 2: pick mw_pilot + lazlos_owner via __uclife__ ──────────────────
await page.evaluate(() => {
  return globalThis.__uclife__.pickAmbitions(['mw_pilot', 'lazlos_owner'])
})
await page.waitForTimeout(300)
// Forced overlay should disappear once active.length === 2.
const stillForced = await page.locator('.status-overlay[data-ambition-picker="forced"]').count()
if (stillForced !== 0) fail('forced picker still visible after picking 2 ambitions')

// Close the panel (it stays open in view mode).
const setOpen = await page.evaluate(() => {
  globalThis.__uclife__.useClock // touch to ensure handle present
  return true
})
if (!setOpen) fail('__uclife__ handle missing')
await page.evaluate(() => { window.uclifeUI.getState().setAmbitions(false) })
await page.waitForTimeout(150)

// ── Step 3: pause, then mutate stats so mw_pilot stage 1 thresholds clear ──
await page.locator('.hud-controls button', { hasText: '暂停' }).click().catch(() => {})
await page.waitForTimeout(200)

await page.evaluate(() => {
  globalThis.__uclife__.setPlayerStat('attributes.reflex', 35)
  globalThis.__uclife__.setPlayerStat('skills.athletics', 600)
})

// ── Step 4: advance one game-day + force a tick ─────────────────────────
await page.evaluate(() => {
  globalThis.__uclife__.advanceGameDays(1)
  globalThis.__uclife__.runAmbitionsTick()
})
await page.waitForTimeout(200)

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

// ── Step 6: open panel, screenshot view mode ─────────────────────────────
await page.evaluate(() => { window.uclifeUI.getState().setAmbitions(true) })
await page.waitForTimeout(200)
await page.screenshot({ path: 'scripts/out/ambition-view.png', fullPage: false })

const titleEl = await page.locator('[data-player-title]').first().textContent().catch(() => null)
if (!titleEl || !titleEl.includes(expectedTitle)) {
  // Title is rendered in StatusPanel, which is a separate panel. Open status to verify.
  await page.evaluate(() => { window.uclifeUI.getState().setAmbitions(false); window.uclifeUI.getState().setStatus(true) })
  await page.waitForTimeout(200)
  const t2 = await page.locator('[data-player-title]').first().textContent().catch(() => null)
  if (!t2 || !t2.includes(expectedTitle)) {
    fail(`StatusPanel title element does not contain '${expectedTitle}': got '${t2}'`)
  }
  await page.evaluate(() => { window.uclifeUI.getState().setStatus(false); window.uclifeUI.getState().setAmbitions(true) })
  await page.waitForTimeout(150)
}

// ── Step 7: save → reload → load → assert persistence ──────────────────
await page.evaluate(() => { window.uclifeUI.getState().setAmbitions(false) })
await page.waitForTimeout(150)

const openSystem = async () => {
  await page.locator('button.hud-system').click()
  await page.waitForTimeout(300)
}
const closeSystem = async () => {
  await page.locator('.status-overlay').first().click({ position: { x: 5, y: 5 } }).catch(() => {})
  await page.waitForTimeout(200)
}
const slotRow = (label) => page.locator('.debug-row', {
  has: page.locator('.debug-row-label', { hasText: label })
})

await openSystem()
await slotRow('存档 1').locator('button.debug-action', { hasText: '保存' }).click()
await page.waitForTimeout(800)
await closeSystem()

// Reload page entirely to prove persistence survives a fresh load.
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1000)

// On reload, the player has 0 ambitions (fresh world) so the forced picker
// reappears and intercepts every click. Dismiss it so the system menu can
// open, then load slot 1 to restore the saved ambitions.
await dismissAmbitionPicker(page)
await openSystem()
await slotRow('存档 1').locator('button.debug-action', { hasText: '读档' }).click()
await page.waitForTimeout(1500)
await closeSystem()

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
