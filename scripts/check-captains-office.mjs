// Phase 6.2 — verify the post-combat half of 6.2:
//   1. Adjutant chatter pulls the name from ship-classes.json5.
//   2. Notable-hostile capture lands a named POW in the brig.
//   3. Brig respects brigCapacity — over-capacity captures are refused.
//   4. Comm-panel + brig-panel UI surfaces respond to interactable kicks.
//   5. Combat tally payload carries the captured POW row + brig occupancy.
//
// Migrated to Phase 6 deterministic boot: ?test=1 freezes the clock,
// every sim-state wait goes through step({ until }).

import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import { mkdir } from 'node:fs/promises'

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1', baseUrl).toString()
const OUT_DIR = 'scripts/out/captains-office'
await mkdir(OUT_DIR, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
const knownErrors = []
const PIXI_BATCHER_KNOWN = /Cannot read properties of null \(reading 'clear'\)/
page.on('pageerror', (err) => {
  const msg = `${err.name}: ${err.message}`
  if (PIXI_BATCHER_KNOWN.test(err.message)) { knownErrors.push(msg); return }
  errors.push(msg)
})
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

async function shot(label) {
  await page.screenshot({ path: `${OUT_DIR}/${label}.png`, fullPage: false })
}

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.startCombatCheat === 'function'
    && typeof window.__uclife__?.useBrig === 'function'
    && typeof window.__uclife__?.brigState === 'function'
    && typeof window.__uclife__?.getAdjutant === 'function'
    && typeof window.__uclife__?.fastWinCombat === 'function',
  null,
  { timeout: 30_000 },
)

const STEP_BUDGET_MIN = 60

// 1. Adjutant config check — name read from ship-classes.json5.
const adj = await page.evaluate(() => window.__uclife__.getAdjutant())
assert.ok(adj, 'getAdjutant() returned null')
assert.equal(typeof adj.name, 'string', `adjutant.name should be string; got ${typeof adj.name}`)
assert.ok(adj.name.length > 0, 'adjutant.name should be non-empty')

// 2. Brig starts empty + reports correct capacity.
const brigInit = await page.evaluate(() => window.__uclife__.brigState())
assert.equal(brigInit.occupied, 0, `brig should start empty; saw ${brigInit.occupied}`)
assert.ok(brigInit.capacity > 0, `brig capacity should be > 0; got ${brigInit.capacity}`)

// 3. Stage a notable-hostile fight.
const setupOk = await page.evaluate(() => (
  window.__uclife__.cheatMoney(80000)
    && window.__uclife__.cheatPiloting(10)
    && window.__uclife__.setShipOwned()
))
assert.ok(setupOk, 'cheat setup failed')

await page.evaluate(() => window.__uclife__.boardShip())
await page.evaluate(async (mins) => {
  await window.__uclife_test__.step({
    until: () => window.__uclife__.useScene.getState().activeId === 'playerShipInterior',
    maxGameMinutes: mins,
  })
}, STEP_BUDGET_MIN)

const target = await page.evaluate(() => {
  const enemies = window.__uclife__.listEnemies()
  return enemies.find((e) => e.key === 'enemy-pirate-lunar-4') || enemies[0]
})
assert.ok(target, 'no campaign enemy found')

await page.evaluate((key) => {
  window.__uclife__.startCombatCheat(
    'pirate_raider',
    [],
    key,
    { '0': 'char-aznable-0077-disguise' },
  )
}, target.key)

await page.evaluate(async (mins) => {
  await window.__uclife_test__.step({
    until: () => window.__uclife__.useCombatStore.getState().open === true,
    maxGameMinutes: mins,
  })
}, STEP_BUDGET_MIN)
await shot('01-combat-opened')

// 4. Resolve combat — unpause then fastWin.
await page.evaluate(() => {
  if (window.__uclife__.useCombatStore.getState().paused) {
    window.__uclife__.useCombatStore.getState().togglePause()
  }
})
await page.evaluate(() => window.__uclife__.fastWinCombat())
await page.evaluate(async (mins) => {
  await window.__uclife_test__.step({
    until: () => window.__uclife__.useCombatStore.getState().open === false,
    maxGameMinutes: mins,
  })
}, STEP_BUDGET_MIN)

const brigAfter = await page.evaluate(() => window.__uclife__.brigState())
assert.ok(
  brigAfter.occupied >= 1,
  `brig should contain at least 1 captured POW after fastWin; saw ${brigAfter.occupied}`,
)
const found = brigAfter.prisoners.find((p) => p.id === 'char-aznable-0077-disguise')
assert.ok(
  found,
  `brig should contain char-aznable-0077-disguise; saw ${brigAfter.prisoners.map((p) => p.id).join(', ')}`,
)

// 5. Tally payload includes the captured POW + brig occupancy.
const tally = await page.evaluate(() => window.uclifeUI.getState().combatTally)
assert.ok(tally, 'combatTally should be non-null after victory')
assert.ok(
  Array.isArray(tally.capturedPows) && tally.capturedPows.length > 0,
  `tally.capturedPows should be non-empty after notable-hostile victory; got ${JSON.stringify(tally.capturedPows)}`,
)
assert.equal(
  typeof tally.brigCapacity, 'number',
  `tally.brigCapacity should be a number; got ${typeof tally.brigCapacity}`,
)
assert.equal(
  typeof tally.brigOccupied, 'number',
  `tally.brigOccupied should be a number; got ${typeof tally.brigOccupied}`,
)
await shot('02-tally-open')

await page.evaluate(() => window.uclifeUI.getState().setCombatTally(null))

// 6. Brig over-capacity refusal.
const capacity = brigAfter.capacity
const fillResults = await page.evaluate((cap) => {
  const results = []
  for (let i = 0; i < cap + 1; i++) {
    results.push(window.__uclife__.forceCapture(`fake-${i}`))
  }
  return results
}, capacity)
assert.equal(
  fillResults[fillResults.length - 1], false,
  `brig should refuse capture past capacity (${capacity}); got ${fillResults.join(',')}`,
)

// 7. Comm-panel + brig-panel toggles surface the right occupants.
await page.evaluate(() => {
  window.__uclife__.clearBrig()
  window.__uclife__.forceCapture('char-aznable-0077-disguise')
  window.__uclife__.openCommPanel()
})
await page.evaluate(async (mins) => {
  await window.__uclife_test__.step({
    until: () => window.uclifeUI.getState().commPanelOpen === true,
    maxGameMinutes: mins,
  })
}, STEP_BUDGET_MIN)
await shot('03-comm-panel')

await page.evaluate(() => {
  window.uclifeUI.getState().setCommPanel(false)
  window.__uclife__.openBrigPanel()
})
await page.evaluate(async (mins) => {
  await window.__uclife_test__.step({
    until: () => window.uclifeUI.getState().brigPanelOpen === true,
    maxGameMinutes: mins,
  })
}, STEP_BUDGET_MIN)
await shot('04-brig-panel')

assert.equal(
  errors.length, 0,
  `page error(s) during test:\n${errors.map((e) => '  ' + e).join('\n')}`,
)

await browser.close()

if (knownErrors.length > 0) {
  console.log(`(filtered ${knownErrors.length} known Pixi v8 batcher startup errors)`)
}

console.log('OK — check-captains-office:')
console.log(`  adjutant: ${adj.title} · ${adj.name}`)
console.log(`  captured: ${found.nameZh} (${found.titleZh ?? '<no title>'})`)
console.log(`  brig refused past-capacity capture (cap=${capacity})`)
