import { chromium } from 'playwright'

const url = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

await page.goto(url, { waitUntil: 'networkidle' })
// Boot is settled once the uiStore + at least one debug handle exist.
await page.waitForFunction(
  () => typeof window.uclifeUI?.getState === 'function'
    && typeof globalThis.__uclife__?.useScene === 'function',
  null,
  { timeout: 30_000 },
)

await page.locator('button.hud-system').click()
// systemOpen flips synchronously inside the click handler — wait on the
// store rather than guessing 300ms for React to commit the panel.
await page.waitForFunction(() => window.uclifeUI.getState().systemOpen === true)
// Wait for the panel header to actually mount before scraping its
// children (Playwright would otherwise race the React commit).
await page.waitForSelector('.status-panel .status-header h2', { timeout: 5_000 })

const buttons = await page.locator('.status-panel button.debug-action').allTextContents()
console.log('system menu actions:', buttons)
const headerTitle = await page.locator('.status-panel .status-header h2').textContent()
console.log('header:', headerTitle)
const autoCheckbox = await page.locator('.status-panel input[type="checkbox"]').count()
console.log('checkboxes:', autoCheckbox)

if (errors.length) {
  console.log('\nERRORS:')
  errors.forEach((e) => console.log('  ' + e))
}

const ok = headerTitle?.trim() === '系统'
  && buttons.includes('保存') && buttons.includes('读档') && buttons.includes('删除')
  && autoCheckbox === 1
  && errors.length === 0

console.log(ok ? '\nOK: system menu rendered.' : '\nFAIL.')
if (!ok) process.exitCode = 1

await browser.close()
