// Probe whether a non-tenant player can walk into a locked cell.
// Uses __uclife__.findLockedCellPath() so trait identity is shared with the
// running app (CLAUDE.md: do not dynamic-import traits in tests).
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const url = process.argv[2] ?? 'http://localhost:5173/'
await mkdir('scripts/out', { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()
const errors = []
const consoleMsgs = []
page.on('pageerror', (err) => errors.push(`${err.name}: ${err.message}`))
page.on('console', (msg) => {
  const t = msg.type()
  if (t === 'error' || t === 'warning') consoleMsgs.push(`[${t}] ${msg.text()}`)
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

const probe = await page.evaluate(() => globalThis.__uclife__.findLockedCellPath())
console.log('probe:', JSON.stringify(probe, null, 2))

if (probe) {
  await page.evaluate((target) => {
    globalThis.__uclife__.setMoveTarget(target)
    globalThis.__uclife__.useClock.setState({ speed: 1, mode: 'normal' })
  }, probe.target)

  await page.waitForTimeout(4000)

  const final = await page.evaluate(() => globalThis.__uclife__.playerSnapshot())
  console.log('final:', JSON.stringify(final, null, 2))

  // Did the player end up on the bed-side of the door?
  const door = probe.door
  const bed = probe.bed
  const crossedDoor = door.orient === 'h'
    ? (bed.y > door.y ? final.pos.y > door.y + door.h : final.pos.y < door.y)
    : (bed.x > door.x ? final.pos.x > door.x + door.w : final.pos.x < door.x)
  console.log('crossedDoor:', crossedDoor)
  await page.screenshot({ path: 'scripts/out/probe-locked-final.png', fullPage: true })
}

if (errors.length) {
  console.log('ERRORS:')
  errors.forEach((e) => console.log('  ' + e))
}
if (consoleMsgs.length) {
  console.log('CONSOLE:')
  consoleMsgs.forEach((m) => console.log('  ' + m))
}

await browser.close()
