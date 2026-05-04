import { chromium } from 'playwright'
import { dismissAmbitionPicker } from './lib/dismissPicker.mjs'

const url = process.argv[2] ?? 'http://localhost:5173/'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await dismissAmbitionPicker(page)

await page.locator('button.hud-system').click()
await page.waitForTimeout(300)

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
