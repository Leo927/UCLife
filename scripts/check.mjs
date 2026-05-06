import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const url = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'

await mkdir('scripts/out', { recursive: true })

const browser = await chromium.launch()

async function probe(label, viewport) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()

  const consoleMsgs = []
  const errors = []
  page.on('console', (msg) => consoleMsgs.push(`[${msg.type()}] ${msg.text()}`))
  page.on('pageerror', (err) => errors.push(`${err.name}: ${err.message}\n${err.stack ?? ''}`))
  page.on('requestfailed', (req) => errors.push(`REQ FAIL ${req.url()} ${req.failure()?.errorText}`))

  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  const dom = await page.evaluate(() => {
    const q = (sel) => !!document.querySelector(sel)
    const count = (sel) => document.querySelectorAll(sel).length
    const canvas = document.querySelector('canvas')
    return {
      title: document.title,
      bodyClasses: document.body.className,
      hud: q('.hud'),
      hudTitle: document.querySelector('.hud-title')?.textContent ?? null,
      statusBtn: q('.hud-status'),
      gameCanvas: q('.game-canvas'),
      canvasW: canvas?.width ?? null,
      canvasH: canvas?.height ?? null,
      vitals: q('.vitals'),
      vitalCount: count('.vital'),
      actionStatus: q('.action-status'),
      death: q('.death-overlay'),
      bodyText: document.body.innerText.slice(0, 300),
    }
  })

  await page.screenshot({ path: `scripts/out/${label}.png`, fullPage: true })

  await page.locator('.status-footer-btn').first().click()
  await page.waitForTimeout(300)
  const panelOpen = await page.evaluate(() => !!document.querySelector('.status-panel'))
  await page.screenshot({ path: `scripts/out/${label}-status.png`, fullPage: true })
  dom.statusPanelOpens = panelOpen

  await ctx.close()

  return { label, viewport, dom, consoleMsgs, errors }
}

const results = []
results.push(await probe('desktop', { width: 1280, height: 800 }))
results.push(await probe('phone', { width: 390, height: 844 }))

for (const r of results) {
  console.log(`\n=== ${r.label} (${r.viewport.width}x${r.viewport.height}) ===`)
  console.log('DOM:', JSON.stringify(r.dom, null, 2))
  if (r.errors.length) {
    console.log('ERRORS:')
    r.errors.forEach((e) => console.log('  ' + e))
  } else {
    console.log('No page errors.')
  }
  if (r.consoleMsgs.length) {
    console.log('CONSOLE:')
    r.consoleMsgs.forEach((m) => console.log('  ' + m))
  }
}

await browser.close()
