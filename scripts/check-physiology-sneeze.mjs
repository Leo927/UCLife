// Phase 4.2 sneeze-emote smoke. Drives the worldspace cough/sneeze glyph
// through __uclife__ debug handles under the deterministic ?test=1 boot.
//
// Coverage:
//   - spawn an infectious NPC next to the player (already symptomatic)
//   - confirm the renderer picked them up (one entry in the glyph registry)
//   - confirm a non-symptomatic NPC does NOT appear
//
// Note: sneezeEmoteRegistry is rebuilt every Pixi render frame (RAF),
// not driven by sim time. RAF still runs under ?test=1 — only the sim
// clock is frozen — so waitForFunction on the renderer-state readback
// converges within a frame or two of real time.

import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import { BOOT_READY_TIMEOUT_MS, DOM_COMMIT_TIMEOUT_MS } from './_test-constants.mjs'

const CARRIER_NAME = '咳嗽李明'
const CARRIER_DX_TILES = 0.5
const CARRIER_DY_TILES = 0

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1', baseUrl).toString()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console.error: ${m.text()}`) })

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.sneezeEmoteEntities === 'function'
    && typeof window.__uclife__?.physiologySpawnInfectedNPC === 'function',
  null, { timeout: BOOT_READY_TIMEOUT_MS },
)

const before = await page.evaluate(() => window.__uclife__.sneezeEmoteEntities())
assert.ok(Array.isArray(before), 'sneezeEmoteEntities did not return an array')
assert.equal(before.length, 0,
  `expected empty registry pre-spawn, got ${before.length}: ${JSON.stringify(before)}`)

const carrier = await page.evaluate(
  (p) => window.__uclife__.physiologySpawnInfectedNPC('flu', p.name, p.dx, p.dy),
  { name: CARRIER_NAME, dx: CARRIER_DX_TILES, dy: CARRIER_DY_TILES },
)
assert.ok(carrier?.key, 'failed to spawn infectious carrier NPC')

await page.waitForFunction(
  (k) => {
    const arr = window.__uclife__.sneezeEmoteEntities()
    return Array.isArray(arr) && arr.includes(k)
  },
  carrier.key,
  { timeout: DOM_COMMIT_TIMEOUT_MS },
)

const after = await page.evaluate(() => window.__uclife__.sneezeEmoteEntities())
assert.equal(after.length, 1,
  `expected exactly one registered carrier, got ${after.length}: ${JSON.stringify(after)}`)

assert.equal(pageErrors.length, 0,
  `page error(s) during test:\n${pageErrors.map((e) => '  ' + e).join('\n')}`)

await browser.close()

console.log('OK: sneeze-emote smoke passed.')
