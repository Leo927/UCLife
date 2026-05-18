// Regression smoke. Drives ?test=1&fixture=minimal-player-only end-
// to-end and asserts the fixture's player state lands authoritatively:
// money, position, skills, and scene all come from the fixture, not
// the default boot spawn that bootTestMode used to leave behind.
//
// Before the fix, bootstrapApp() spawned a default player with
// startingMoney=30 BEFORE applyFixture() spawned the fixture-defined
// player (money=1234), and getPlayerCharacter() returned the default
// one. So any of the asserts below would catch the regression.

import { chromium } from 'playwright'

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1&fixture=minimal-player-only', baseUrl).toString()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })

// Boot-existence one-shot — sole allowed waitForFunction per CLAUDE.md.
await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.getGameState === 'function',
  null,
  { timeout: 30_000 },
)

const failures = []

const snap = await page.evaluate(() => {
  const gs = window.__uclife__.getGameState()
  const p = gs.getPlayerCharacter()
  return {
    money: p.getResource('Money'),
    piloting: p.getStat('piloting'),
    pos: p.getPosition(),
  }
})

const EXPECT_MONEY = 1234
const EXPECT_PILOTING = 42
const EXPECT_TILE = { x: 10, y: 12 }
// Tile pixel size — applyPlayer multiplies fixture tile coords by
// worldConfig.tilePx (32) before storing as Position. Hardcoded here
// since the smoke test has no source-of-truth import path.
const TILE_PX = 32

if (snap.money !== EXPECT_MONEY) {
  failures.push(`player.Money = ${snap.money}, want ${EXPECT_MONEY} (fixture player.money) — default boot spawn likely shadowing fixture`)
}
if (snap.piloting !== EXPECT_PILOTING) {
  failures.push(`player.piloting = ${snap.piloting}, want ${EXPECT_PILOTING} (fixture player.skills.piloting)`)
}
if (snap.pos.x !== EXPECT_TILE.x * TILE_PX || snap.pos.y !== EXPECT_TILE.y * TILE_PX) {
  failures.push(
    `player.position = (${snap.pos.x},${snap.pos.y}) px, want (${EXPECT_TILE.x * TILE_PX},${EXPECT_TILE.y * TILE_PX}) ` +
    `from fixture tile (${EXPECT_TILE.x},${EXPECT_TILE.y})`,
  )
}
if (snap.pos.scene !== 'vonBraunCity') {
  failures.push(`player scene = "${snap.pos.scene}", want "vonBraunCity" (fixture player.location.scene)`)
}

if (failures.length || errors.length) {
  console.log('\nFAIL — check-fixture-authority:')
  for (const f of failures) console.log('  -', f)
  if (errors.length) {
    console.log('\npage errors / console.error:')
    for (const e of errors) console.log('  -', e)
  }
  console.log('\nsnap =', JSON.stringify(snap, null, 2))
  process.exitCode = 1
} else {
  console.log('OK — check-fixture-authority:')
  console.log(`  player.Money       : ${snap.money}`)
  console.log(`  player.piloting    : ${snap.piloting}`)
  console.log(`  player.position    : (${snap.pos.x},${snap.pos.y}) px in ${snap.pos.scene}`)
}

await browser.close()
