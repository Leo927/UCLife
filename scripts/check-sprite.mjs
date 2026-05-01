import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, 'out')
await mkdir(outDir, { recursive: true })

const url = process.argv[2] ?? 'http://localhost:5173/'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`pageerror ${e.name}: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

const lpcRequests = []
page.on('response', (r) => {
  const u = r.url()
  if (u.includes('/lpc/')) lpcRequests.push({ url: u, status: r.status() })
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)

await page.evaluate(() => window.uclifeSpriteTester())
await page.waitForTimeout(2000) // image load + recolor

await page.fill('input[type=text]', 'Wei Tanaka')
await page.waitForTimeout(500)
await page.evaluate(() => {
  const sel = document.querySelectorAll('select')[1]
  if (sel) {
    sel.value = 'male'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  }
})
await page.waitForTimeout(2000)

const stats = await page.evaluate(() => {
  // Skip the Game stage's Konva canvas by picking the canvas inside the
  // SpriteTester modal overlay (z-index 9999).
  const overlay = Array.from(document.querySelectorAll('div')).find(
    (d) => getComputedStyle(d).zIndex === '9999',
  )
  const canvas = overlay?.querySelector('canvas')
  if (!canvas) return { found: false }
  const ctx = canvas.getContext('2d')
  if (!ctx) return { found: true, ctx: false }
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  let opaque = 0
  for (let i = 3; i < img.length; i += 4) {
    if (img[i] > 0) opaque++
  }
  return {
    found: true,
    ctx: true,
    width: canvas.width,
    height: canvas.height,
    opaquePixels: opaque,
    totalPixels: img.length / 4,
  }
})

await page.screenshot({ path: join(outDir, 'sprite-tester.png'), fullPage: false })

await browser.close()

let failed = false
console.log('--- LPC sprite smoke test ---')
console.log(`canvas: ${JSON.stringify(stats)}`)
console.log(`lpc requests: ${lpcRequests.length} (${lpcRequests.filter((r) => r.status === 200).length} ok, ${lpcRequests.filter((r) => r.status !== 200).length} fail)`)
for (const r of lpcRequests) {
  console.log(`  ${r.status} ${r.url}`)
}
if (errors.length) {
  console.log(`errors:`)
  for (const e of errors) console.log(`  ${e}`)
  failed = true
}
if (!stats.found || !stats.ctx) {
  console.log('FAIL: no canvas found')
  failed = true
} else if (stats.width !== 832 || stats.height !== 256) {
  console.log(`FAIL: expected 832x256 sheet, got ${stats.width}x${stats.height}`)
  failed = true
} else if (stats.opaquePixels < 1000) {
  console.log(`FAIL: only ${stats.opaquePixels} opaque pixels — likely empty sheet`)
  failed = true
}
if (lpcRequests.length === 0) {
  console.log('FAIL: no /lpc/ requests captured — middleware not exercised')
  failed = true
}
if (failed) {
  process.exit(1)
}
console.log('OK')
