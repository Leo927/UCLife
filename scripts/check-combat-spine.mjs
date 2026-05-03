// Phase 6.0 combat-spine smoke. Drives the slice 1-7 spine end-to-end:
//
//   board ship → take helm → set autopilot toward an enemy → wait for the
//   engagement modal → resolve 'engage' → tactical combat opens → fastWin →
//   combat resolves cleanly → clock back to normal mode.
//
// Each step writes a screenshot under scripts/out/combat-spine/. Helpers are
// driven through window.__uclife__ so we don't depend on Konva click hit
// boxes or the helm Interactable tile geometry.

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
    && typeof window.__uclife__.takeHelmCheat === 'function'
    && typeof window.__uclife__.tickSpace === 'function'
    && typeof window.__uclife__.moveShipTo === 'function'
    && typeof window.__uclife__.listEnemies === 'function'
    && typeof window.__uclife__.fastWinCombat === 'function',
  { label: '__uclife__ smoke handle' },
)
if (!ready) {
  fail('__uclife__ smoke handle missing required helpers')
  await browser.close()
  process.exit(1)
}
await shot('00-booted')

// ── Step 1: Cheat to ship-owning state ───────────────────────────────
const cheatOk = await page.evaluate(() => {
  return (
    window.__uclife__.cheatMoney(80000) &&
    window.__uclife__.cheatPiloting(10) &&
    window.__uclife__.setShipOwned()
  )
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
  await browser.close()
  process.exit(1)
}
pass('boarded ship — active scene = playerShipInterior')
await shot('01-boarded')

// ── Step 3: Take helm via takeHelmCheat (debits fuel, sets AtHelm) ───
const fuelBefore = await page.evaluate(() => window.__uclife__.getShipState()?.fuelCurrent ?? null)
const helmRes = await page.evaluate(() => window.__uclife__.takeHelmCheat())
if (!helmRes || helmRes.ok !== true) {
  fail(`takeHelmCheat failed: ${helmRes && helmRes.message}`)
  await browser.close()
  process.exit(1)
}
const inSpace = await waitFor(
  () => window.__uclife__.useScene.getState().activeId === 'spaceCampaign',
  { label: 'scene swap to spaceCampaign' },
)
if (!inSpace) {
  fail('did not arrive in spaceCampaign after takeHelm')
  await browser.close()
  process.exit(1)
}
const fuelAfter = await page.evaluate(() => window.__uclife__.getShipState()?.fuelCurrent ?? null)
if (fuelBefore !== null && fuelAfter !== null && fuelAfter > fuelBefore) {
  fail(`takeHelm did not debit fuel (before=${fuelBefore} after=${fuelAfter})`)
} else {
  pass(`took helm — active scene = spaceCampaign · fuel ${fuelBefore} → ${fuelAfter}`)
}
await shot('02-at-helm')

// ── Step 4: Pick a hand-placed enemy and teleport the ship to within
// the contact radius minus a buffer so a single tick triggers the
// engagement modal deterministically. The space sim's contact radius is
// ~120px (spaceConfig.aggroContactRadius); 60px is well inside.
const enemies = await page.evaluate(() => window.__uclife__.listEnemies())
if (!enemies || enemies.length === 0) {
  fail('no enemies present in spaceCampaign')
  await browser.close()
  process.exit(1)
}
const target = enemies[0]
console.log(`  targeting enemy ${target.key} at (${target.pos.x.toFixed(1)}, ${target.pos.y.toFixed(1)})`)

// Snap the ship right next to the enemy and set a course so the integrator
// has a non-zero state (course is mostly cosmetic — contact detection is
// position-based).
const teleported = await page.evaluate(({ x, y }) => {
  return window.__uclife__.moveShipTo(x - 60, y) &&
    window.__uclife__.setCourse(x, y, null)
}, target.pos)
if (!teleported) {
  fail('moveShipTo / setCourse failed')
  await browser.close()
  process.exit(1)
}
pass(`ship teleported to (~60px from enemy) and course set`)

// Drive the space sim directly via tickSpace so contact detection runs
// without depending on the RAF loop's pace. One tick is enough at 60px
// inside aggro radius. Loop a few times in case the prompt is gated by
// the initial out-of-aggro flag (the first tick marks the enemy
// in-contact, the next can prompt — see spaceSim.ts cooldown logic).
let promptOpen = false
for (let i = 0; i < 30; i++) {
  await page.evaluate(() => window.__uclife__.tickSpace(0.05))
  promptOpen = await page.evaluate(
    () => window.__uclife__.useEngagement.getState().open === true,
  )
  if (promptOpen) break
}
if (!promptOpen) {
  fail('engagement modal did not open within 30 ticks')
  await shot('03a-no-prompt')
  await browser.close()
  process.exit(1)
}
pass('engagement modal opened')
await shot('03-engagement-prompt')

// ── Step 5: Resolve 'engage' → tactical combat overlay ───────────────
await page.evaluate(() => window.__uclife__.useEngagement.getState().resolve('engage'))
const combatOpened = await waitFor(
  () => window.__uclife__.useCombatStore.getState().open === true,
  { timeoutMs: 3000, label: 'combat overlay open' },
)
if (!combatOpened) {
  fail('combat overlay did not open after engage')
  await browser.close()
  process.exit(1)
}
pass('combat overlay open')
await shot('04-combat-open')

// ── Step 6: Force-resolve via fastWinCombat ──────────────────────────
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
await shot('05-resolved')

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
