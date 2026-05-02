import { chromium } from 'playwright'

const url = 'http://localhost:5173/'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.name}: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

const probeScene = async (label) => {
  return await page.evaluate(() => {
    const u = globalThis.__uclife__
    if (!u) return { error: 'no __uclife__' }
    return {
      activeScene: u.useScene.getState().activeId,
      swapNonce: u.useScene.getState().swapNonce,
      counts: u.countByKind(),
    }
  })
}

// Pause
await page.locator('.hud-controls button', { hasText: '暂停' }).click()
await page.waitForTimeout(400)
console.log('before-save:', JSON.stringify(await probeScene()))

// Save slot 1
await page.locator('button.hud-system').click()
await page.waitForTimeout(300)
await page.locator('.debug-row', { has: page.locator('.debug-row-label', { hasText: '存档 1' }) })
  .locator('button.debug-action', { hasText: '保存' }).click()
await page.waitForTimeout(800)
await page.locator('.status-overlay').click({ position: { x: 5, y: 5 } }).catch(() => {})
await page.waitForTimeout(300)

await page.locator('.hud-controls button', { hasText: '4×' }).click()
await page.waitForTimeout(2500)
console.log('before-load:', JSON.stringify(await probeScene()))

await page.locator('button.hud-system').click()
await page.waitForTimeout(300)
await page.locator('.debug-row', { has: page.locator('.debug-row-label', { hasText: '存档 1' }) })
  .locator('button.debug-action', { hasText: '读档' }).click()
await page.waitForTimeout(2500)
await page.locator('.status-overlay').click({ position: { x: 5, y: 5 } }).catch(() => {})
await page.waitForTimeout(800)
console.log('after-load:', JSON.stringify(await probeScene()))

await page.screenshot({ path: 'scripts/out/after-load.png' })

// Try unpausing
await page.locator('.hud-controls button', { hasText: '1×' }).click()
await page.waitForTimeout(2000)
console.log('after-unpause:', JSON.stringify(await probeScene()))
await page.screenshot({ path: 'scripts/out/after-load-moved.png' })

if (errors.length) {
  console.log('\nERRORS:')
  errors.forEach((e) => console.log('  ' + e))
} else {
  console.log('no errors')
}

await browser.close()
