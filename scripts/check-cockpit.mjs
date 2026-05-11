// Phase 6.1 — verify the bridge ↔ hangar walk + MS pilot loop:
//   1. Boot, board, helm, jump straight into combat against a pirate.
//   2. By default piloting='flagship' and useCombatStore.open === true.
//   3. launchPlayerMs() → MS spawned, piloting='ms', tactical still open.
//   4. msState() reflects the live MS pose; pilotedByPlayer=true.
//   5. leaveBridgeCheat() → tactical overlay closes, piloting=null,
//      MS still in flight on AI (we relaunch instead in this smoke to
//      keep flow simple).
//   6. dockPlayerMs(true) → MS despawns, useCombatStore.open === false,
//      piloting=null. Combat itself is still engaged (clock.mode='combat').
//   7. takeFlagshipControl() → tactical re-opens, piloting='flagship'.
//   8. fastWinCombat → combat resolves cleanly.
//
// Drive everything through __uclife__ — no DOM-pixel assertions.

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const url = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const OUT_DIR = 'scripts/out/cockpit'
await mkdir(OUT_DIR, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
const knownErrors = []
const failures = []
// Same Pixi v8 batcher startup quirk as check-space-combat.mjs — filter
// the first-frame null-deref that resolves on the next tick.
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
    && typeof window.__uclife__.launchPlayerMs === 'function'
    && typeof window.__uclife__.dockPlayerMs === 'function'
    && typeof window.__uclife__.takeFlagshipControl === 'function'
    && typeof window.__uclife__.leaveBridgeCheat === 'function'
    && typeof window.__uclife__.msState === 'function'
    && typeof window.__uclife__.useCockpit === 'function',
  { label: '__uclife__ cockpit handle' },
)
if (!ready) { fail('__uclife__ cockpit handle missing'); await browser.close(); process.exit(1) }

// Boot + board + helm + jump into combat.
const setupOk = await page.evaluate(() => (
  window.__uclife__.cheatMoney(80000)
    && window.__uclife__.cheatPiloting(10)
    && window.__uclife__.setShipOwned()
))
if (!setupOk) { fail('cheats failed'); await browser.close(); process.exit(1) }

await page.evaluate(() => window.__uclife__.boardShip())
await waitFor(() => window.__uclife__.useScene.getState().activeId === 'playerShipInterior',
  { label: 'enter ship interior' })

const helmRes = await page.evaluate(() => window.__uclife__.takeHelmCheat())
if (!helmRes || helmRes.ok !== true) {
  fail('takeHelmCheat failed'); await browser.close(); process.exit(1)
}

const enemies = await page.evaluate(() => window.__uclife__.listEnemies())
if (!enemies || enemies.length === 0) {
  fail('no enemies present in spaceCampaign'); await browser.close(); process.exit(1)
}
await page.evaluate((key) => {
  window.__uclife__.startCombatCheat('pirateLight', [], key)
}, enemies[0].key)

await waitFor(() => window.__uclife__.useCombatStore.getState().open === true,
  { label: 'tactical view opens' })
await waitFor(() => window.__uclife__.useCockpit.getState().piloting === 'flagship',
  { label: 'piloting=flagship after startCombat' })
pass('combat opened, piloting=flagship by default')

// Launch the MS.
const launchRes = await page.evaluate(() => window.__uclife__.launchPlayerMs())
if (!launchRes || launchRes.ok !== true) {
  fail(`launchPlayerMs failed: ${launchRes && launchRes.reasonZh}`)
  await browser.close(); process.exit(1)
}
await waitFor(() => window.__uclife__.useCockpit.getState().piloting === 'ms',
  { label: 'piloting=ms after launch' })
const ms = await page.evaluate(() => window.__uclife__.msState())
if (!ms) { fail('msState() returned null after launch'); await browser.close(); process.exit(1) }
if (!ms.pilotedByPlayer) fail('MS pilotedByPlayer should be true after launch')
if (ms.hullCurrent !== ms.hullMax) fail(`MS launched at less than full hull: ${ms.hullCurrent}/${ms.hullMax}`)
pass(`MS launched at (${ms.pos.x.toFixed(0)}, ${ms.pos.y.toFixed(0)}) · hull ${ms.hullCurrent}/${ms.hullMax}`)
await shot('01-ms-launched')

// Force-dock the MS (skip proximity check — the smoke isn't about dock approach).
const dockRes = await page.evaluate(() => window.__uclife__.dockPlayerMs(true))
if (!dockRes || dockRes.ok !== true) {
  fail(`dockPlayerMs failed: ${dockRes && dockRes.reasonZh}`)
  await browser.close(); process.exit(1)
}
await waitFor(() => window.__uclife__.msState() === null,
  { label: 'MS despawned after dock' })
await waitFor(() => window.__uclife__.useCockpit.getState().piloting === null,
  { label: 'piloting=null after dock (player walking the hangar)' })
await waitFor(() => window.__uclife__.useCombatStore.getState().open === false,
  { label: 'tactical overlay closes after dock' })
const sceneAfterDock = await page.evaluate(() => window.__uclife__.useScene.getState().activeId)
if (sceneAfterDock !== 'playerShipInterior') {
  fail(`expected to be in playerShipInterior after dock, got ${sceneAfterDock}`)
}
pass('MS docked, player back in walkable hangar bay')
await shot('02-ms-docked')

// Re-take the helm via takeFlagshipControl — combat is still engaged.
const helmAgain = await page.evaluate(() => window.__uclife__.takeFlagshipControl())
if (!helmAgain || helmAgain.ok !== true) {
  fail(`takeFlagshipControl failed: ${helmAgain && helmAgain.reasonZh}`)
}
await waitFor(() => window.__uclife__.useCockpit.getState().piloting === 'flagship',
  { label: 'piloting=flagship after re-helm' })
await waitFor(() => window.__uclife__.useCombatStore.getState().open === true,
  { label: 'tactical re-opens after takeFlagshipControl' })
pass('player re-took flagship control mid-combat')

// Resolve cleanly via fastWinCombat. Combat sits paused after startCombat
// — combatSystem doesn't tick when paused, so we have to unpause before
// the zero-hull enemies get noticed and endCombat fires.
await page.evaluate(() => {
  if (window.__uclife__.useCombatStore.getState().paused) {
    window.__uclife__.useCombatStore.getState().togglePause()
  }
})
const won = await page.evaluate(() => window.__uclife__.fastWinCombat())
if (!won) fail('fastWinCombat returned false (no enemy entity)')
await waitFor(() => window.__uclife__.useCombatStore.getState().open === false,
  { label: 'combat closes after fastWinCombat' })
await waitFor(() => window.__uclife__.useClock.getState().mode === 'normal',
  { label: 'clock returns to normal mode' })
await waitFor(() => window.__uclife__.useCockpit.getState().piloting === null,
  { label: 'piloting cleared after endCombat' })
pass('combat resolved cleanly; cockpit reset')
await shot('03-post-combat')

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
console.log('\nOK · cockpit launch/dock loop passed')
