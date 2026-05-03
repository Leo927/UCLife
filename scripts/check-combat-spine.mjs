// Phase 6.0 Slice K — combat-spine vertical smoke test.
//
// Drives the full FTL-shape spine end-to-end through the __uclife__ debug
// handle: cheat into ship-owning state, board, open starmap, jump to a
// pirate-patrol node, accept an encounter combat outcome, force-resolve the
// fight, and verify the world unwinds back to normal.
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

// Wait for an arbitrary predicate evaluated in the page. Returns true on
// success, false on timeout. Generous timeouts because the jump transition
// is 600ms+midpoint+600ms and combat resolution depends on RAF cadence.
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
    && typeof window.__uclife__.jumpTo === 'function',
  { label: '__uclife__ smoke handle' },
)
if (!ready) {
  fail('__uclife__ smoke handle not exposed')
  await browser.close()
  process.exit(1)
}
await shot('00-booted')

// ── Step 1: Cheat to ship-owning state ───────────────────────────────
// Skip the AE-walk to dealer; Phase 6.1 owns that flow and has its own
// dedicated smoke test.
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

// ── Step 4: Jump to shoalPatrol ─────────────────────────────────────
// vonBraun is the starting docked node. The spine reachability graph
// puts shoalPatrol two hops away (via lunaII), so the smoke jumps
// vonBraun → lunaII → shoalPatrol in sequence.
const dockedBefore = await page.evaluate(
  () => window.__uclife__.getShipState()?.dockedAtNodeId,
)
console.log('Initially docked at:', dockedBefore)
if (dockedBefore !== 'vonBraun') {
  fail(`expected initial docked node to be vonBraun, got ${dockedBefore}`)
}

// Hop 1: vonBraun → lunaII. routine_jump (lunarSphere pool) may fire here.
// Close any encounter immediately to keep the spine on rails.
await page.evaluate(() => window.__uclife__.jumpTo('lunaII'))
const jump1Done = await waitFor(
  () => {
    const ship = window.__uclife__.getShipState()
    return !!ship && ship.dockedAtNodeId === 'lunaII'
  },
  { timeoutMs: 5000, label: 'docked at lunaII' },
)
if (!jump1Done) {
  fail('first hop (vonBraun → lunaII) did not complete')
  await shot('03a-jump1-fail')
  await browser.close()
  process.exit(1)
}
// If lunarSphere pool rolled an encounter at lunaII, dismiss it.
const enc1 = await page.evaluate(() => {
  const e = window.__uclife__.useEncounter.getState().current
  return e ? e.template.id : null
})
if (enc1) {
  console.log(`  lunaII rolled encounter: ${enc1} — closing`)
  await page.evaluate(() => window.__uclife__.useEncounter.getState().close())
}
pass('hop 1 complete · docked at lunaII')
await shot('03-at-lunaII')

// Wait for the fade-in tail to finish — canJumpTo refuses while a previous
// transition is still inProgress.
await waitFor(
  () => window.__uclife__.useTransition.getState().inProgress === false,
  { timeoutMs: 2000, label: 'transition idle' },
)

// Re-open starmap (closed automatically by jumpTo) for hop 2.
await page.evaluate(() => window.uclifeUI.getState().setStarmap(true))
await page.waitForTimeout(150)

// Hop 2: lunaII → shoalPatrol. shoalPatrol's encounterPoolId is
// `pirate_patrol_pool` — Slice K's resolver strips the `_pool` suffix and
// finds the real `pirate_patrol` template.
await page.evaluate(() => window.__uclife__.jumpTo('shoalPatrol'))
// Wait for both: transition idle (so the fade-in cover is gone) and
// encounter open. Race-safe because encounter is set during midpoint and
// remains open until resolved — we never see a "transition done but no
// encounter yet" gap.
const jump2Done = await waitFor(
  () => {
    const ship = window.__uclife__.getShipState()
    const enc = window.__uclife__.useEncounter.getState().current
    const t = window.__uclife__.useTransition.getState()
    return ship && ship.dockedAtNodeId === 'shoalPatrol' && enc !== null && t.inProgress === false
  },
  { timeoutMs: 5000, label: 'docked at shoalPatrol with encounter open and transition idle' },
)
if (!jump2Done) {
  fail('jump to shoalPatrol did not produce docked-at + encounter')
  await shot('04a-jump2-fail')
} else {
  pass('hop 2 complete · docked at shoalPatrol, encounter open')
}
await shot('04-encounter-open')

// ── Step 5: Verify the right encounter fired ─────────────────────────
const encId = await page.evaluate(
  () => window.__uclife__.useEncounter.getState().current?.template?.id ?? null,
)
console.log('Encounter template id:', encId)
if (encId !== 'pirate_patrol') {
  fail(`expected encounter 'pirate_patrol', got '${encId}'`)
} else {
  pass(`encounter fired: pirate_patrol`)
}

// ── Step 6: Resolve "engage" → combat ────────────────────────────────
await page.evaluate(() =>
  window.__uclife__.useEncounter.getState().resolveChoice('engage'),
)
const combatOpened = await waitFor(
  () => window.__uclife__.useCombatStore.getState().open === true,
  { timeoutMs: 3000, label: 'combat overlay open' },
)
if (!combatOpened) {
  fail('combat overlay did not open after engage')
} else {
  pass('combat overlay open')
}
await shot('05-combat-open')

const pausedOnEntry = await page.evaluate(
  () => window.__uclife__.useCombatStore.getState().paused,
)
if (pausedOnEntry !== true) {
  fail(`expected combat paused on entry, got paused=${pausedOnEntry}`)
} else {
  pass('combat paused on entry (FTL convention)')
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

// combatSystem detects hullCurrent <= 0 on its next tick (per-frame at
// running clock speed). Wait for endCombat() to flip everything back.
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
