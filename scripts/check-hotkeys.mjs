import { chromium } from 'playwright'

const url = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`pageerror ${e.name}: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction(() => typeof globalThis.__uclife__?.fillJobVacancies === 'function')
await page.waitForFunction(() => typeof window.uclifeUI?.getState === 'function')
// Hud's keydown listener registers in a useEffect; wait for it to be live by
// firing a probe keypress and confirming it flips the store. Without this the
// test races boot and silently drops early keystrokes.
await page.waitForFunction(async () => {
  const before = window.uclifeUI.getState().statusOpen
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', key: 'c', bubbles: true }))
  const after = window.uclifeUI.getState().statusOpen
  if (after !== before) {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', key: 'c', bubbles: true }))
    return true
  }
  return false
}, null, { timeout: 10_000, polling: 200 })

const state = () => page.evaluate(() => {
  const s = window.uclifeUI.getState()
  return { statusOpen: s.statusOpen, inventoryOpen: s.inventoryOpen, mapOpen: s.mapOpen, systemOpen: s.systemOpen }
})

async function press(key) {
  await page.keyboard.press(key)
  await page.waitForTimeout(60)
}

// C opens status
await press('c')
let s = await state()
if (!s.statusOpen) errors.push(`C should open status, got ${JSON.stringify(s)}`)
// ESC closes
await press('Escape')
s = await state()
if (s.statusOpen) errors.push(`ESC should close status, got ${JSON.stringify(s)}`)
// C again toggles open
await press('c')
s = await state()
if (!s.statusOpen) errors.push(`C should re-open status, got ${JSON.stringify(s)}`)
// C toggles closed
await press('c')
s = await state()
if (s.statusOpen) errors.push(`C should toggle status off, got ${JSON.stringify(s)}`)

// I opens inventory
await press('i')
s = await state()
if (!s.inventoryOpen) errors.push(`I should open inventory, got ${JSON.stringify(s)}`)
await press('Escape')
s = await state()
if (s.inventoryOpen) errors.push(`ESC should close inventory, got ${JSON.stringify(s)}`)

// C while inventory open: no-op (anyModal block)
await page.evaluate(() => window.uclifeUI.getState().setInventory(true))
await press('c')
s = await state()
if (s.statusOpen) errors.push(`C should not open status while inventory open`)
if (!s.inventoryOpen) errors.push(`Inventory should remain open after C press`)
await page.evaluate(() => window.uclifeUI.getState().setInventory(false))

// ESC with no modal: no-op
await press('Escape')
s = await state()
if (s.statusOpen || s.inventoryOpen || s.mapOpen || s.systemOpen) errors.push(`ESC opened something with no modal: ${JSON.stringify(s)}`)

// ESC closes systemMenu (opened via store)
await page.evaluate(() => window.uclifeUI.getState().setSystem(true))
await press('Escape')
s = await state()
if (s.systemOpen) errors.push(`ESC should close systemMenu, got ${JSON.stringify(s)}`)

await browser.close()

if (errors.length) {
  console.error('FAIL:', errors.join('\n  '))
  process.exit(1)
}
console.log('OK: hotkeys C/I/ESC behave correctly')
