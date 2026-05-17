import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import { BOOT_READY_TIMEOUT_MS, VIEWPORT } from './_test-constants.mjs'

// Phase 4.2 flu contagion smoke test — migrated to the deterministic
// API (Phase 6, Category A). Drives an SIR transmission end-to-end:
// the sim clock is frozen by ?test=1; physiologyContagionStep advances
// the contagion sim N ticks deterministically, and physiologyTickDay
// advances the carrier's phase machine.
//
// Coverage:
//   - spawn an infectious NPC half a tile from the player (inside flu's
//     1.5-tile contactRadius)
//   - advance contagion ticks
//   - verify player catches flu (source string names the carrier)
//   - verify flu's symptomatic-rising band emits a workPerfMul drop

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1', baseUrl).toString()

const CARRIER_TILE_DX = 0.5
const CARRIER_TILE_DY = 0
const CONTAGION_TICKS = 200
const PHASE_WALK_DAYS = 3
const SYMPTOM_SEVERITY_THRESHOLD = 20
const BASELINE_WORK_PERF_MUL = 1

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: VIEWPORT })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })

await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.physiologySpawnInfectedNPC === 'function'
    && typeof window.__uclife__?.physiologyContagionStep === 'function'
    && typeof window.__uclife__?.physiologyTickDay === 'function'
    && typeof window.__uclife__?.getNpcConditionsByKey === 'function'
    && typeof window.__uclife__?.getPlayerStatValue === 'function',
  null,
  { timeout: BOOT_READY_TIMEOUT_MS },
)

const carrier = await page.evaluate(([dx, dy]) =>
  window.__uclife__.physiologySpawnInfectedNPC('flu', '李明', dx, dy),
  [CARRIER_TILE_DX, CARRIER_TILE_DY],
)
assert.ok(carrier?.key, 'failed to spawn infected carrier NPC')
assert.equal(carrier.templateId, 'flu',
  `spawned carrier had wrong templateId: ${carrier.templateId}`)

const playerCond = await page.evaluate((n) =>
  window.__uclife__.physiologyContagionStep(n),
  CONTAGION_TICKS,
)
assert.ok(Array.isArray(playerCond),
  'physiologyContagionStep did not return a conditions array')
const flu = playerCond.find((c) => c.templateId === 'flu')
assert.ok(flu, `player did not catch flu after ${CONTAGION_TICKS} contagion ticks`)
assert.ok(typeof flu.source === 'string' && flu.source.includes('李明'),
  `flu.source should name the carrier 李明, got: ${flu.source}`)
assert.ok(flu.source.includes('流感'),
  `flu.source should name the condition 流感, got: ${flu.source}`)

const carrierCond = await page.evaluate(
  (k) => window.__uclife__.getNpcConditionsByKey(k),
  carrier.key,
)
assert.ok(Array.isArray(carrierCond), 'failed to fetch carrier conditions by key')
const carrierFlu = carrierCond.find((c) => c.templateId === 'flu')
assert.ok(carrierFlu, 'carrier no longer carries flu')
assert.notEqual(carrierFlu.phase, 'incubating',
  'carrier still in incubating after force-advance to rising')

const afterDays = await page.evaluate((n) =>
  window.__uclife__.physiologyTickDay(n), PHASE_WALK_DAYS)
assert.ok(Array.isArray(afterDays), 'physiologyTickDay did not return an array')
const fluAfter = afterDays.find((c) => c.templateId === 'flu')
assert.ok(fluAfter,
  `player flu disappeared after ${PHASE_WALK_DAYS} days — expected to still be in arc`)
const wpm = await page.evaluate(() => window.__uclife__.getPlayerStatValue('workPerfMul'))
if (fluAfter.severity >= SYMPTOM_SEVERITY_THRESHOLD && typeof wpm === 'number') {
  assert.ok(wpm < BASELINE_WORK_PERF_MUL,
    `workPerfMul should be reduced by flu band at severity ${fluAfter.severity}, got ${wpm}`)
}

assert.equal(errors.length, 0,
  `page error(s) during test:\n${errors.map((e) => '  ' + e).join('\n')}`)

console.log('OK — check-physiology-contagion:')
console.log(`  carrier: ${carrier.key} at (+${CARRIER_TILE_DX},${CARRIER_TILE_DY}) tile from player`)
console.log(`  player caught flu after ${CONTAGION_TICKS} contagion ticks`)
console.log(`  flu source: ${flu.source}`)
console.log(`  workPerfMul at severity ${fluAfter.severity}: ${wpm}`)

await browser.close()
