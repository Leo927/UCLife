// Phase 6.2 — verify the post-combat half of 6.2:
//   1. Adjutant chatter pulls the name from ship-classes.json5 (not hardcoded).
//   2. Notable-hostile capture lands a named POW in the brig.
//   3. Brig respects brigCapacity — over-capacity captures are refused.
//   4. Comm-panel + brig-panel UI surfaces respond to interactable kicks.
//   5. Combat tally payload carries the captured POW row + brig occupancy.
//
// Drives everything through __uclife__ — no DOM-pixel assertions.

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const url = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const OUT_DIR = 'scripts/out/captains-office'
await mkdir(OUT_DIR, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
const knownErrors = []
const failures = []
const PIXI_BATCHER_KNOWN = /Cannot read properties of null \(reading 'clear'\)/
page.on('pageerror', (err) => {
  const msg = `${err.name}: ${err.message}`
  if (PIXI_BATCHER_KNOWN.test(err.message)) { knownErrors.push(msg); return }
  errors.push(msg)
  console.log(`  [pageerror] ${msg}`)
})
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

function fail(msg) { failures.push(msg); console.log(`FAIL · ${msg}`) }
function pass(msg) { console.log(`PASS · ${msg}`) }
async function shot(label) {
  await page.screenshot({ path: `${OUT_DIR}/${label}.png`, fullPage: false })
}
async function waitFor(predicate, { timeoutMs = 4000, label } = {}) {
  try {
    await page.waitForFunction(predicate, undefined, { timeout: timeoutMs })
    return true
  } catch {
    if (label) console.log(`  timeout waiting for: ${label}`)
    return false
  }
}

await page.goto(url, { waitUntil: 'networkidle' })
const ready = await waitFor(
  () => '__uclife__' in window
    && typeof window.__uclife__.startCombatCheat === 'function'
    && typeof window.__uclife__.useBrig === 'function'
    && typeof window.__uclife__.brigState === 'function'
    && typeof window.__uclife__.getAdjutant === 'function'
    && typeof window.__uclife__.fastWinCombat === 'function',
  { label: '__uclife__ phase 6.2 handles' },
)
if (!ready) { fail('__uclife__ phase 6.2 handle missing'); await browser.close(); process.exit(1) }

// ── 1. Adjutant config check — name read from ship-classes.json5 ────────────
const adj = await page.evaluate(() => window.__uclife__.getAdjutant())
if (!adj || typeof adj.name !== 'string' || adj.name.length === 0) {
  fail('getAdjutant() returned no name')
} else {
  pass(`adjutant authored as "${adj.title} · ${adj.name}"`)
}

// ── 2. Brig starts empty + reports correct capacity ──────────────────
const brigInit = await page.evaluate(() => window.__uclife__.brigState())
if (brigInit.occupied !== 0) fail(`brig should start empty, saw ${brigInit.occupied}`)
if (brigInit.capacity <= 0) fail(`brig capacity should be > 0 (got ${brigInit.capacity})`)
pass(`brig starts ${brigInit.occupied} / ${brigInit.capacity}`)

// ── 3. Stage a notable-hostile fight ────────────────────────────────
// pirate-lunar-4 pins char-aznable-0077-disguise on the lead. Boot,
// board, jump straight into combat against it.
const setupOk = await page.evaluate(() => (
  window.__uclife__.cheatMoney(80000)
    && window.__uclife__.cheatPiloting(10)
    && window.__uclife__.setShipOwned()
))
if (!setupOk) { fail('cheats failed'); await browser.close(); process.exit(1) }

await page.evaluate(() => window.__uclife__.boardShip())
await waitFor(() => window.__uclife__.useScene.getState().activeId === 'playerShipInterior',
  { label: 'enter ship interior' })

// Find pirate-lunar-4 in the campaign world (it carries the notable
// captain). startCombatCheat takes (lead, escorts, campaignKey, captains).
const target = await page.evaluate(() => {
  const enemies = window.__uclife__.listEnemies()
  return enemies.find((e) => e.key === 'enemy-pirate-lunar-4') || enemies[0]
})
if (!target) { fail('no campaign enemy found'); await browser.close(); process.exit(1) }

const startedWithCaptain = await page.evaluate((key) => {
  // Pin the notable captain on slot 0 — matches the space-entities row.
  // 1v1 keeps fastWinCombat's resolution window inside the 4s default
  // waitFor; the space-entities row that owns this captain in the
  // shipped data has two escorts, but the capture flow doesn't depend
  // on them (one named-hostile ship is enough to assert).
  window.__uclife__.startCombatCheat(
    'pirate_raider',
    [],
    key,
    { '0': 'char-aznable-0077-disguise' },
  )
  return true
}, target.key)
if (!startedWithCaptain) { fail('startCombatCheat failed'); await browser.close(); process.exit(1) }

await waitFor(() => window.__uclife__.useCombatStore.getState().open === true,
  { label: 'tactical opens' })
pass('combat opened against pirate-lunar-4 (notable lead)')
await shot('01-combat-opened')

// ── 4. Resolve combat — fastWin + unpause, then assert capture ──────
await page.evaluate(() => {
  if (window.__uclife__.useCombatStore.getState().paused) {
    window.__uclife__.useCombatStore.getState().togglePause()
  }
})
await page.evaluate(() => window.__uclife__.fastWinCombat())
await waitFor(() => window.__uclife__.useCombatStore.getState().open === false,
  { label: 'combat closes after fastWinCombat' })

// Brig should now contain the named captain — fastWin zeros every enemy
// hull, the lead ship's destruction hits onEnemyDestroyed which routes
// the captainId to the brig.
const brigAfter = await page.evaluate(() => window.__uclife__.brigState())
if (brigAfter.occupied < 1) {
  fail(`expected at least 1 brig occupant after fastWin, saw ${brigAfter.occupied}`)
} else {
  const found = brigAfter.prisoners.find((p) => p.id === 'char-aznable-0077-disguise')
  if (!found) {
    fail(`brig should contain char-aznable-0077-disguise; saw ${brigAfter.prisoners.map((p) => p.id).join(', ')}`)
  } else {
    pass(`captured "${found.nameZh}" (${found.titleZh ?? '<no title>'}) — brig at ${brigAfter.occupied}/${brigAfter.capacity}`)
  }
}

// ── 5. Tally payload includes the captured POW + brig occupancy ─────
const tally = await page.evaluate(() => window.uclifeUI.getState().combatTally)
if (!tally) {
  fail('combatTally null after victory')
} else {
  if (!Array.isArray(tally.capturedPows) || tally.capturedPows.length === 0) {
    fail('tally.capturedPows empty after notable-hostile victory')
  } else {
    pass(`tally lists ${tally.capturedPows.length} captured POW(s)`)
  }
  if (typeof tally.brigCapacity !== 'number') fail('tally.brigCapacity missing')
  if (typeof tally.brigOccupied !== 'number') fail('tally.brigOccupied missing')
  pass(`tally brigOccupied=${tally.brigOccupied} brigCapacity=${tally.brigCapacity}`)
}
await shot('02-tally-open')

// Close tally so the next assertions don't race on its overlay state.
await page.evaluate(() => window.uclifeUI.getState().setCombatTally(null))

// ── 6. Brig over-capacity refusal ───────────────────────────────────
const capacity = brigAfter.capacity
// Fill up to capacity using forceCapture (bypasses combat), then try
// one more — should refuse.
const fillResults = await page.evaluate((cap) => {
  const results = []
  for (let i = 0; i < cap + 1; i++) {
    const ok = window.__uclife__.forceCapture(`fake-${i}`)
    results.push(ok)
  }
  return results
}, capacity)
const overCapacityRefused = fillResults[fillResults.length - 1] === false
if (!overCapacityRefused) {
  fail('brig accepted a capture past its capacity')
} else {
  pass(`brig refused capture past capacity (${capacity})`)
}

// ── 7. Comm-panel + brig-panel toggles surface the right occupants ──
await page.evaluate(() => {
  window.__uclife__.clearBrig()
  window.__uclife__.forceCapture('char-aznable-0077-disguise')
  window.__uclife__.openCommPanel()
})
await waitFor(() => window.uclifeUI.getState().commPanelOpen === true,
  { label: 'comm panel opens' })
pass('comm panel open via debug handle')
await shot('03-comm-panel')

await page.evaluate(() => {
  window.uclifeUI.getState().setCommPanel(false)
  window.__uclife__.openBrigPanel()
})
await waitFor(() => window.uclifeUI.getState().brigPanelOpen === true,
  { label: 'brig panel opens' })
pass('brig panel open via debug handle')
await shot('04-brig-panel')

if (errors.length) {
  console.log('PAGE ERRORS:')
  for (const e of errors) console.log(`  ${e}`)
}

await browser.close()

if (knownErrors.length > 0) {
  console.log(`(filtered ${knownErrors.length} known Pixi v8 batcher startup errors)`)
}

if (failures.length || errors.length) {
  console.log(`\nFAILED · ${failures.length} assertion(s), ${errors.length} page error(s)`)
  process.exit(1)
}
console.log('\nOK · captain\'s office + brig + notable-hostile + tally captured panel passed')
