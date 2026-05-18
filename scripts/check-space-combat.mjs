// Phase 6.0 — verify the engagement → tactical → resolution loop:
//   1. Boot via ?test=1, board, take helm.
//   2. Pick a campaign-world enemy, jump straight into combat with
//      startCombatCheat (passing the real EntityKey so victory cleanup
//      exercises destroyCampaignEnemyByKey).
//   3. Verify useCombatStore.open === true and clock.mode === 'combat'.
//   4. endCombatCheat('victory') drives resolution deterministically —
//      under ?test=1 the prod RAF loop is stopped, so combatSystem has
//      to be driven explicitly. fastWinCombat() runs first to zero the
//      enemy hull so endCombat's victory branch fires the campaign
//      cleanup; endCombatCheat seals the deal.
//   5. Verify combat closed, clock.mode === 'normal', and the
//      campaign-world EnemyAI entity for the engaged enemy is destroyed.

import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import { mkdir } from 'node:fs/promises'
import { BOOT_READY_TIMEOUT_MS, DOM_COMMIT_TIMEOUT_MS } from './_test-constants.mjs'

const OUT_DIR = 'scripts/out/space-combat'
await mkdir(OUT_DIR, { recursive: true })

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1', baseUrl).toString()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

// Pixi v8 emits a null-deref inside its batcher on the first render
// frame after a second Pixi Application boots (TacticalView's overlay
// on top of SpaceView). The geometry recovers immediately. Filter the
// known signature; surface any unexpected errors.
const PIXI_BATCHER_KNOWN = /Cannot read properties of null \(reading 'clear'\)/
const knownErrors = []
const pageErrors = []
page.on('pageerror', (e) => {
  const msg = `${e.name}: ${e.message}`
  if (PIXI_BATCHER_KNOWN.test(e.message)) { knownErrors.push(msg); return }
  pageErrors.push(msg)
})
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console.error: ${m.text()}`) })

async function shot(label) {
  await page.screenshot({ path: `${OUT_DIR}/${label}.png`, fullPage: false })
}

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.takeHelmCheat === 'function'
    && typeof window.__uclife__?.startCombatCheat === 'function'
    && typeof window.__uclife__?.fastWinCombat === 'function'
    && typeof window.__uclife__?.endCombatCheat === 'function'
    && typeof window.__uclife__?.listEnemies === 'function'
    && typeof window.__uclife__?.cheatMoney === 'function'
    && typeof window.__uclife__?.cheatPiloting === 'function'
    && typeof window.__uclife__?.setShipOwned === 'function'
    && typeof window.__uclife__?.boardShip === 'function'
    && typeof window.__uclife__?.useScene === 'function',
  null, { timeout: BOOT_READY_TIMEOUT_MS },
)

const STARTUP_MONEY = 80_000
const STARTUP_PILOTING = 10

const setupOk = await page.evaluate((args) => (
  window.__uclife__.cheatMoney(args.money)
    && window.__uclife__.cheatPiloting(args.piloting)
    && window.__uclife__.setShipOwned()
), { money: STARTUP_MONEY, piloting: STARTUP_PILOTING })
assert.ok(setupOk, 'cheat-money/piloting/ownership setup failed')

await page.evaluate(() => window.__uclife__.boardShip())
await page.waitForFunction(
  () => window.__uclife__.useScene.getState().activeId === 'playerShipInterior',
  null, { timeout: DOM_COMMIT_TIMEOUT_MS },
)

const helmRes = await page.evaluate(() => window.__uclife__.takeHelmCheat())
assert.equal(helmRes?.ok, true, `takeHelmCheat failed: ${helmRes?.message}`)

await page.waitForFunction(
  () => window.__uclife__.useScene.getState().activeId === 'spaceCampaign',
  null, { timeout: DOM_COMMIT_TIMEOUT_MS },
)
console.log('booted + boarded + helm')

const enemies = await page.evaluate(() => window.__uclife__.listEnemies())
assert.ok(enemies.length > 0, 'no enemies present in spaceCampaign')
const target = enemies[0]
console.log(`engaging ${target.key} at (${target.pos.x.toFixed(0)}, ${target.pos.y.toFixed(0)})`)

await page.evaluate(
  (key) => window.__uclife__.startCombatCheat('pirateLight', [], key),
  target.key,
)

const openedCombat = await page.evaluate(() => ({
  open: window.__uclife__.useCombatStore.getState().open,
  mode: window.__uclife__.useClock.getState().mode,
}))
assert.equal(openedCombat.open, true, 'tactical view did not open')
assert.equal(openedCombat.mode, 'combat', `clock mode = ${openedCombat.mode} (want combat)`)
console.log('combat opened, clock in combat mode')
await shot('01-combat-open')

const won = await page.evaluate(() => window.__uclife__.fastWinCombat())
assert.equal(won, true, 'fastWinCombat returned false (no enemy entity)')

await page.evaluate(() => window.__uclife__.endCombatCheat('victory'))

const resolved = await page.evaluate(() => ({
  open: window.__uclife__.useCombatStore.getState().open,
  mode: window.__uclife__.useClock.getState().mode,
}))
assert.equal(resolved.open, false, `combat still open after endCombatCheat: ${JSON.stringify(resolved)}`)
assert.equal(resolved.mode, 'normal', `clock mode after victory = ${resolved.mode} (want normal)`)
console.log('combat resolved cleanly')

const survivorList = await page.evaluate(() => window.__uclife__.listEnemies())
const stillThere = survivorList.find((e) => e.key === target.key)
assert.equal(stillThere, undefined,
  `campaign enemy ${target.key} still alive after victory — endCombat didn't clean it up`)
console.log(`campaign enemy ${target.key} destroyed (was ${enemies.length}, now ${survivorList.length})`)

await shot('02-post-combat')

assert.equal(pageErrors.length, 0,
  `page error(s) during test:\n${pageErrors.map((e) => '  ' + e).join('\n')}`)

if (knownErrors.length > 0) {
  console.log(`(filtered ${knownErrors.length} known Pixi v8 batcher startup errors)`)
}

await browser.close()

console.log('\nOK · combat engagement loop passed')
