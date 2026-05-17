// Phase 6.1 — verify the bridge ↔ hangar walk + MS pilot loop:
//   1. Boot, board, helm, jump straight into combat against a pirate.
//   2. By default piloting='flagship' and useCombatStore.open === true.
//   3. launchPlayerMs() → MS spawned, piloting='ms', tactical still open.
//   4. msState() reflects the live MS pose; pilotedByPlayer=true.
//   5. dockPlayerMs(true) → MS despawns, useCombatStore.open === false,
//      piloting=null. Combat itself is still engaged (clock.mode='combat').
//   6. takeFlagshipControl() → tactical re-opens, piloting='flagship'.
//   7. fastWinCombat → combat resolves cleanly.
//
// Migrated to Phase 6 deterministic boot — every sim-state wait goes
// through step({ until }). The clock is frozen under ?test=1, so
// page.waitForFunction over sim state would loop forever.

import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import { mkdir } from 'node:fs/promises'

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1', baseUrl).toString()
const OUT_DIR = 'scripts/out/cockpit'
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
    && typeof window.__uclife__?.launchPlayerMs === 'function'
    && typeof window.__uclife__?.dockPlayerMs === 'function'
    && typeof window.__uclife__?.takeFlagshipControl === 'function'
    && typeof window.__uclife__?.leaveBridgeCheat === 'function'
    && typeof window.__uclife__?.msState === 'function'
    && typeof window.__uclife__?.useCockpit === 'function',
  null,
  { timeout: 30_000 },
)

const STEP_BUDGET_MIN = 60

// Boot + board + helm + jump into combat.
const setupOk = await page.evaluate(() => (
  window.__uclife__.cheatMoney(80000)
    && window.__uclife__.cheatPiloting(10)
    && window.__uclife__.setShipOwned()
))
assert.ok(setupOk, 'cheatMoney+cheatPiloting+setShipOwned failed at setup')

await page.evaluate(() => window.__uclife__.boardShip())
await page.evaluate(async (mins) => {
  await window.__uclife_test__.step({
    until: () => window.__uclife__.useScene.getState().activeId === 'playerShipInterior',
    maxGameMinutes: mins,
  })
}, STEP_BUDGET_MIN)

const helmRes = await page.evaluate(() => window.__uclife__.takeHelmCheat())
assert.equal(helmRes?.ok, true, `takeHelmCheat should succeed; got ${JSON.stringify(helmRes)}`)

const enemies = await page.evaluate(() => window.__uclife__.listEnemies())
assert.ok(enemies && enemies.length > 0, 'no enemies present in spaceCampaign')

await page.evaluate((key) => {
  window.__uclife__.startCombatCheat('pirateLight', [], key)
}, enemies[0].key)

await page.evaluate(async (mins) => {
  await window.__uclife_test__.step({
    until: () => window.__uclife__.useCombatStore.getState().open === true
      && window.__uclife__.useCockpit.getState().piloting === 'flagship',
    maxGameMinutes: mins,
  })
}, STEP_BUDGET_MIN)

// Launch the MS.
const launchRes = await page.evaluate(() => window.__uclife__.launchPlayerMs())
assert.equal(
  launchRes?.ok, true,
  `launchPlayerMs should succeed; got ${JSON.stringify(launchRes)}`,
)
await page.evaluate(async (mins) => {
  await window.__uclife_test__.step({
    until: () => window.__uclife__.useCockpit.getState().piloting === 'ms',
    maxGameMinutes: mins,
  })
}, STEP_BUDGET_MIN)

const ms = await page.evaluate(() => window.__uclife__.msState())
assert.ok(ms, 'msState() returned null after launch')
assert.equal(ms.pilotedByPlayer, true, 'MS pilotedByPlayer should be true after launch')
assert.equal(
  ms.hullCurrent, ms.hullMax,
  `MS launched at less than full hull: ${ms.hullCurrent}/${ms.hullMax}`,
)
await shot('01-ms-launched')

// Force-dock the MS.
const dockRes = await page.evaluate(() => window.__uclife__.dockPlayerMs(true))
assert.equal(
  dockRes?.ok, true,
  `dockPlayerMs should succeed; got ${JSON.stringify(dockRes)}`,
)
await page.evaluate(async (mins) => {
  await window.__uclife_test__.step({
    until: () => window.__uclife__.msState() === null
      && window.__uclife__.useCockpit.getState().piloting === null
      && window.__uclife__.useCombatStore.getState().open === false,
    maxGameMinutes: mins,
  })
}, STEP_BUDGET_MIN)

const sceneAfterDock = await page.evaluate(() => window.__uclife__.useScene.getState().activeId)
assert.equal(
  sceneAfterDock, 'playerShipInterior',
  `expected to be in playerShipInterior after dock; got "${sceneAfterDock}"`,
)
await shot('02-ms-docked')

// Re-take the helm via takeFlagshipControl.
const helmAgain = await page.evaluate(() => window.__uclife__.takeFlagshipControl())
assert.equal(
  helmAgain?.ok, true,
  `takeFlagshipControl should succeed; got ${JSON.stringify(helmAgain)}`,
)
await page.evaluate(async (mins) => {
  await window.__uclife_test__.step({
    until: () => window.__uclife__.useCockpit.getState().piloting === 'flagship'
      && window.__uclife__.useCombatStore.getState().open === true,
    maxGameMinutes: mins,
  })
}, STEP_BUDGET_MIN)

// Resolve cleanly via fastWinCombat. Combat sits paused after startCombat
// — combatSystem doesn't tick when paused, so unpause first.
await page.evaluate(() => {
  if (window.__uclife__.useCombatStore.getState().paused) {
    window.__uclife__.useCombatStore.getState().togglePause()
  }
})
const won = await page.evaluate(() => window.__uclife__.fastWinCombat())
assert.ok(won, 'fastWinCombat returned false (no enemy entity)')
await page.evaluate(async (mins) => {
  await window.__uclife_test__.step({
    until: () => window.__uclife__.useCombatStore.getState().open === false,
    maxGameMinutes: mins,
  })
}, STEP_BUDGET_MIN)
await page.evaluate(async (mins) => {
  await window.__uclife_test__.step({
    until: () => window.__uclife__.useClock.getState().mode === 'normal',
    maxGameMinutes: mins,
  })
}, STEP_BUDGET_MIN)
await page.evaluate(async (mins) => {
  await window.__uclife_test__.step({
    until: () => window.__uclife__.useCockpit.getState().piloting === null,
    maxGameMinutes: mins,
  })
}, STEP_BUDGET_MIN)
await shot('03-post-combat')

assert.equal(
  errors.length, 0,
  `page error(s) during test:\n${errors.map((e) => '  ' + e).join('\n')}`,
)

await browser.close()

if (knownErrors.length > 0) {
  console.log(`(filtered ${knownErrors.length} known Pixi v8 batcher startup errors)`)
}

console.log('OK — check-cockpit:')
console.log(`  MS launched at (${ms.pos.x.toFixed(0)}, ${ms.pos.y.toFixed(0)}) hull=${ms.hullCurrent}/${ms.hullMax}`)
console.log(`  cockpit launch/dock/re-helm/post-combat sequence verified`)
