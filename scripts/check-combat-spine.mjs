// Phase 6.0 Starsector-pivot — combat spine vertical smoke test.
//
// Drives the new continuous-space spine end-to-end through the __uclife__
// debug handle: cheat into ship-owning state, board, open starmap, burn to
// a pirate-patrol POI, accept an encounter combat outcome, force-resolve
// the fight, and verify the world unwinds back to normal.
//
// REQUIRES a dev server already running on :5173 — run `npm run dev` first.
//
// CLAUDE.md note: cheats are routed through __uclife__ helpers rather than
// dynamic-importing /src/ecs/traits.ts, because Vite serves the dynamic
// import as a *separate* module instance and trait identities won't match
// the running app.

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const url = process.argv[2] ?? 'http://localhost:5173/'
const OUT_DIR = 'scripts/out/combat-spine'
await mkdir(OUT_DIR, { recursive: true })

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
const failures = []
page.on('pageerror', (err) => errors.push(`${err.name}: ${err.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
})

function fail(msg) {
  failures.push(msg)
  console.log(`FAIL · ${msg}`)
}
function pass(msg) {
  console.log(`PASS · ${msg}`)
}
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

// ── Step 0: Boot ─────────────────────────────────────────────────────
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)

const ready = await waitFor(
  () => 'uclifeUI' in window && '__uclife__' in window
    && typeof window.__uclife__.boardShip === 'function'
    && typeof window.__uclife__.burnToPoi === 'function'
    && typeof window.__uclife__.forceCompleteBurn === 'function',
  { label: '__uclife__ smoke handle' },
)
if (!ready) {
  fail('__uclife__ smoke handle not exposed')
  await browser.close()
  process.exit(1)
}
await shot('00-booted')

// ── Step 1: Cheat to ship-owning state ───────────────────────────────
const cheatOk = await page.evaluate(() => {
  const ok =
    window.__uclife__.cheatMoney(80000) &&
    window.__uclife__.cheatPiloting(10) &&
    window.__uclife__.setShipOwned()
  return ok
})
if (!cheatOk) {
  fail('cheats failed (player entity missing?)')
  await browser.close()
  process.exit(1)
}
pass('cheats applied (money 80000, piloting 10, shipOwned=true)')

// ── Step 2: Board ship ───────────────────────────────────────────────
await page.evaluate(() => window.__uclife__.boardShip())
const boardedOk = await waitFor(
  () => window.__uclife__.useScene.getState().activeId === 'playerShipInterior',
  { label: 'scene swap to playerShipInterior' },
)
if (!boardedOk) {
  fail('did not arrive in playerShipInterior')
} else {
  pass('boarded ship — active scene = playerShipInterior')
}
await shot('01-boarded')

// ── Step 3: Open starmap ─────────────────────────────────────────────
await page.evaluate(() => window.uclifeUI.getState().setStarmap(true))
await page.waitForTimeout(200)
const starmapOpen = await page.evaluate(() => window.uclifeUI.getState().starmapOpen)
if (!starmapOpen) {
  fail('starmap did not open')
} else {
  pass('starmap open')
}
await shot('02-starmap-open')

// ── Step 4: Burn to a pirate-territory POI ──────────────────────────
const dockedBefore = await page.evaluate(
  () => window.__uclife__.getShipState()?.dockedAtPoiId,
)
console.log('Initially docked at:', dockedBefore)
if (dockedBefore !== 'vonBraun') {
  fail(`expected initial docked POI to be vonBraun, got ${dockedBefore}`)
}

// side6 (Riah) is a major POI in the shoalZone region with no sceneId,
// so a burn-arrival fires that region's encounter pool (pirate_patrol +
// debris/derelict/salvage). Continuous-space travel reaches any POI in
// one burn within the fuel budget.
const target = 'side6'

// Plot the burn, then fast-forward game-time to its arrival so the smoke
// test isn't gated on real-time burn duration. forceCompleteBurn snaps
// the fleet to the dest POI, docks, and fires the arrival encounter.
await page.evaluate((t) => window.__uclife__.burnToPoi(t), target)
await page.evaluate(() => window.__uclife__.forceCompleteBurn())
const burnDone = await waitFor(
  () => {
    const ship = window.__uclife__.getShipState()
    return ship && ship.dockedAtPoiId === 'side6' && ship.burnPlan === null
  },
  { timeoutMs: 4000, label: 'docked at side6 with burn plan cleared' },
)
if (!burnDone) {
  fail('burn to side6 did not complete')
  await shot('04a-burn-fail')
  await browser.close()
  process.exit(1)
}
pass('burn complete · docked at side6')

// side6 carries a sceneId (Side 6 dockable in the data file? — currently
// NO; only vonBraun + side3 are dockable). Non-dockable POIs roll their
// region's encounter pool on arrival. shoalZone region has pirate_patrol
// in its pool with weight 4 — but the roll is RNG, so we may need to
// retry burns until pirate_patrol fires.
//
// For deterministic spine coverage, we instead trigger pirate_patrol
// directly via __uclife__ if it didn't fire from the burn.
let encId = await page.evaluate(
  () => window.__uclife__.useEncounter.getState().current?.template?.id ?? null,
)
if (!encId) {
  console.log('  (no encounter rolled at side6; triggering pirate_patrol directly)')
  await page.evaluate(() => {
    window.__uclife__.useEncounter.getState().trigger('pirate_patrol', { poiId: 'side6' })
  })
  encId = await page.evaluate(
    () => window.__uclife__.useEncounter.getState().current?.template?.id ?? null,
  )
}
if (encId !== 'pirate_patrol') {
  fail(`expected encounter 'pirate_patrol', got '${encId}'`)
} else {
  pass(`encounter active: pirate_patrol`)
}
await shot('04-encounter-open')

// ── Step 6: Resolve "engage" → tactical combat ───────────────────────
await page.evaluate(() =>
  window.__uclife__.useEncounter.getState().resolveChoice('engage'),
)
const combatOpened = await waitFor(
  () => window.__uclife__.useCombatStore.getState().open === true,
  { timeoutMs: 3000, label: 'tactical view open' },
)
if (!combatOpened) {
  fail('tactical view did not open after engage')
} else {
  pass('tactical view open')
}
await shot('05-combat-open')

const pausedOnEntry = await page.evaluate(
  () => window.__uclife__.useCombatStore.getState().paused,
)
if (pausedOnEntry !== true) {
  fail(`expected combat paused on entry, got paused=${pausedOnEntry}`)
} else {
  pass('combat paused on entry (Starsector convention)')
}

// ── Step 7: Unpause ──────────────────────────────────────────────────
await page.evaluate(() =>
  window.__uclife__.useCombatStore.getState().togglePause(),
)
const unpaused = await page.evaluate(
  () => window.__uclife__.useCombatStore.getState().paused === false,
)
if (!unpaused) {
  fail('togglePause did not unpause')
} else {
  pass('combat unpaused')
}

// ── Step 8: Force-resolve via fastWinCombat ──────────────────────────
const winCheatOk = await page.evaluate(() => window.__uclife__.fastWinCombat())
if (!winCheatOk) {
  fail('fastWinCombat returned false (no enemy entity?)')
} else {
  pass('enemy hull zeroed')
}

const resolved = await waitFor(
  () => {
    const cs = window.__uclife__.useCombatStore.getState()
    const ship = window.__uclife__.getShipState()
    const clock = window.__uclife__.useClock.getState()
    return cs.open === false && clock.mode === 'normal' && ship && ship.inCombat === false
  },
  { timeoutMs: 3000, label: 'combat resolved → normal mode' },
)
if (!resolved) {
  const snap = await page.evaluate(() => ({
    combat: window.__uclife__.useCombatStore.getState(),
    clock: { mode: window.__uclife__.useClock.getState().mode, speed: window.__uclife__.useClock.getState().speed },
    ship: window.__uclife__.getShipState(),
  }))
  console.log('Resolution snapshot:', JSON.stringify(snap, null, 2))
  fail('combat did not resolve to normal mode')
} else {
  pass('combat resolved · overlay closed, clock=normal, inCombat=false')
}
await shot('06-resolved')

// ── Final dump ───────────────────────────────────────────────────────
const log = await page.evaluate(() => window.__uclife__.getEventLog())
console.log('\n--- event log -----------------------------------------------')
for (const e of log) console.log(`  ${e.text}`)
console.log('-------------------------------------------------------------\n')

if (errors.length) {
  console.log('PAGE ERRORS:')
  for (const e of errors) console.log(`  ${e}`)
} else {
  console.log('No page errors.')
}

await browser.close()

if (failures.length || errors.length) {
  console.log(`\nFAILED · ${failures.length} assertion(s), ${errors.length} page error(s)`)
  process.exit(1)
}
console.log('\nOK · combat-spine smoke passed')
