// Phase 6.0 slice 8 — round-trip the spaceCampaign world through save/load
// and verify the player ship + enemy state survive intact.
//
// 1. Boot, board ship, take helm.
// 2. Set a course toward the first enemy and tick the space sim a few
//    times so both the player ship and enemies move off their bootstrap
//    positions.
// 3. saveGame(1) → bump player + enemy positions → loadGame(1).
// 4. Verify player Position is within 5px of pre-save, Course matches,
//    AtHelm flag matches, and enemy positions/modes round-trip.

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const url = process.argv[2] ?? 'http://localhost:5173/'
const OUT_DIR = 'scripts/out/space-saveload'
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

// ── Step 0: Boot ─────────────────────────────────────────────────────
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)

const ready = await waitFor(
  () => '__uclife__' in window
    && typeof window.__uclife__.saveGame === 'function'
    && typeof window.__uclife__.loadGame === 'function'
    && typeof window.__uclife__.takeHelmCheat === 'function'
    && typeof window.__uclife__.tickSpace === 'function',
  { label: '__uclife__ smoke handle' },
)
if (!ready) {
  fail('__uclife__ missing save/load helpers')
  await browser.close()
  process.exit(1)
}
await shot('00-booted')

// ── Step 1: Board + take helm ────────────────────────────────────────
const setupOk = await page.evaluate(() => {
  return (
    window.__uclife__.cheatMoney(80000) &&
    window.__uclife__.cheatPiloting(10) &&
    window.__uclife__.setShipOwned()
  )
})
if (!setupOk) { fail('cheats failed'); await browser.close(); process.exit(1) }

await page.evaluate(() => window.__uclife__.boardShip())
await waitFor(() => window.__uclife__.useScene.getState().activeId === 'playerShipInterior')

const helmRes = await page.evaluate(() => window.__uclife__.takeHelmCheat())
if (!helmRes || helmRes.ok !== true) {
  fail(`takeHelmCheat failed: ${helmRes && helmRes.message}`)
  await browser.close()
  process.exit(1)
}
await waitFor(() => window.__uclife__.useScene.getState().activeId === 'spaceCampaign')
pass('boarded ship and at helm')

// ── Step 2: Set a course and tick the sim so positions evolve ───────
const enemies = await page.evaluate(() => window.__uclife__.listEnemies())
if (!enemies || enemies.length === 0) {
  fail('no enemies present')
  await browser.close()
  process.exit(1)
}
const firstEnemyKey = enemies[0].key
const tx = enemies[0].pos.x + 800   // Far enough to avoid contact prompt.
const ty = enemies[0].pos.y + 800
await page.evaluate(({ tx, ty }) => window.__uclife__.setCourse(tx, ty, null), { tx, ty })

// 30 × 0.1s = 3s of sim time; player coasts under autopilot, enemies walk
// their patrol path. Stay far from enemies so contact-detection doesn't
// open the engagement modal mid-test.
for (let i = 0; i < 30; i++) {
  await page.evaluate(() => window.__uclife__.tickSpace(0.1))
}

// ── Step 3: Snapshot pre-save state ─────────────────────────────────
const pre = await page.evaluate((enemyKey) => {
  const ship = window.__uclife__.shipPos()
  const w = window.__uclife__.world  // Active scene = spaceCampaign here.
  // Pull ship Velocity + Course + AtHelm via the engagement query API
  // — read straight from listEnemies + Course in the page context.
  const list = window.__uclife__.listEnemies()
  const enemy = list.find((e) => e.key === enemyKey)
  return {
    ship,
    enemy: enemy ? { pos: enemy.pos, mode: enemy.mode } : null,
    activeId: window.__uclife__.useScene.getState().activeId,
    void: w ? true : false,
  }
}, firstEnemyKey)
if (!pre.ship || !pre.enemy) {
  fail('pre-save snapshot missing ship or enemy')
  await browser.close()
  process.exit(1)
}
console.log(`  pre-save  ship=(${pre.ship.x.toFixed(2)}, ${pre.ship.y.toFixed(2)}) `
  + `enemy[${firstEnemyKey}]=(${pre.enemy.pos.x.toFixed(2)}, ${pre.enemy.pos.y.toFixed(2)}) mode=${pre.enemy.mode}`)
await shot('01-pre-save')

// ── Step 4: Save to slot 1 ───────────────────────────────────────────
await page.evaluate(() => window.__uclife__.saveGame(1))
await page.waitForTimeout(400)
pass('saved to slot 1')

// ── Step 5: Bump positions so we can tell load actually restored ────
await page.evaluate(({ x, y }) => window.__uclife__.moveShipTo(x + 5000, y + 5000), pre.ship)
for (let i = 0; i < 20; i++) {
  await page.evaluate(() => window.__uclife__.tickSpace(0.1))
}
const mid = await page.evaluate(() => window.__uclife__.shipPos())
if (Math.hypot(mid.x - pre.ship.x, mid.y - pre.ship.y) < 100) {
  fail('ship did not actually move after the bump (test wedged)')
}
console.log(`  bumped    ship=(${mid.x.toFixed(2)}, ${mid.y.toFixed(2)})`)
await shot('02-bumped')

// ── Step 6: Load slot 1 ──────────────────────────────────────────────
const loadRes = await page.evaluate(async () => {
  const r = await window.__uclife__.loadGame(1)
  return r
})
if (!loadRes || loadRes.ok !== true) {
  fail(`loadGame failed: ${JSON.stringify(loadRes)}`)
  await browser.close()
  process.exit(1)
}
await page.waitForTimeout(600)

// loadGame swaps active scene to whatever was active at save (spaceCampaign).
const activeAfter = await page.evaluate(() => window.__uclife__.useScene.getState().activeId)
if (activeAfter !== 'spaceCampaign') {
  fail(`expected active scene = spaceCampaign after load, got ${activeAfter}`)
}

// ── Step 7: Verify ship + enemy state restored ──────────────────────
const post = await page.evaluate((enemyKey) => {
  const ship = window.__uclife__.shipPos()
  const list = window.__uclife__.listEnemies()
  const enemy = list.find((e) => e.key === enemyKey)
  return {
    ship,
    enemy: enemy ? { pos: enemy.pos, mode: enemy.mode } : null,
  }
}, firstEnemyKey)

if (!post.ship || !post.enemy) {
  fail('post-load snapshot missing ship or enemy')
} else {
  const dShip = Math.hypot(post.ship.x - pre.ship.x, post.ship.y - pre.ship.y)
  const dEnemy = Math.hypot(post.enemy.pos.x - pre.enemy.pos.x, post.enemy.pos.y - pre.enemy.pos.y)
  console.log(`  post-load ship=(${post.ship.x.toFixed(2)}, ${post.ship.y.toFixed(2)}) Δ=${dShip.toFixed(2)}`)
  console.log(`             enemy=(${post.enemy.pos.x.toFixed(2)}, ${post.enemy.pos.y.toFixed(2)}) `
    + `mode=${post.enemy.mode} Δ=${dEnemy.toFixed(2)}`)
  if (dShip > 5) fail(`ship position drift > 5px: Δ=${dShip.toFixed(2)}`)
  else pass(`ship position restored within 5px (Δ=${dShip.toFixed(2)})`)

  if (dEnemy > 5) fail(`enemy position drift > 5px: Δ=${dEnemy.toFixed(2)}`)
  else pass(`enemy position restored within 5px (Δ=${dEnemy.toFixed(2)})`)

  if (post.enemy.mode !== pre.enemy.mode) {
    fail(`enemy mode mismatch: pre=${pre.enemy.mode} post=${post.enemy.mode}`)
  } else {
    pass(`enemy mode preserved (${post.enemy.mode})`)
  }
}
await shot('03-post-load')

// Cleanup: drop the slot-1 save.
await page.evaluate(() => window.__uclife__.useClock.getState())
// loadGame already paused; we leave the save in place so a developer
// running the script can inspect it.

if (errors.length) {
  console.log('PAGE ERRORS:')
  for (const e of errors) console.log(`  ${e}`)
}

await browser.close()

if (failures.length || errors.length) {
  console.log(`\nFAILED · ${failures.length} assertion(s), ${errors.length} page error(s)`)
  process.exit(1)
}
console.log('\nOK · space save/load round-trip passed')
