// Phase 6 deterministic migration of the scene-swap smoke. Two-leg flight:
//   1. Open the Von Braun flight modal via the UI store.
//   2. Click the real 购票 button.
//   3. Wait for the RAF-driven transition to complete + the scene to swap.
//   4. Repeat for the return leg (zumCity → vonBraunCity).
//
// Migrated to the deterministic stack: ?test=1&fixture=player-with-cash-at-vb,
// real `page.click('.transit-terminal-go')`. The fade animation is driven
// by `requestAnimationFrame` and `performance.now()` — those are browser
// state, NOT sim state. The frozen-clock rule applies to sim-state polling,
// not to RAF animations, so it's fine to wait on the transition overlay
// detaching + active scene flipping (both browser-side).
//
// The flight's midpoint callback calls `useClock.getState().advance(durMin)`
// which mutates gameDate directly. simNow is NOT advanced. The migration
// asserts on the destination scene + player arrival pixel — both are
// authoritative state, not clock progression. Clock-progression assertions
// would need step({ gameMinutes }) (which is the sole way to advance simNow
// in test mode).

import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import {
  BOOT_READY_TIMEOUT_MS, DOM_COMMIT_TIMEOUT_MS, VIEWPORT,
  isExpectedTestModePortraitMissing,
} from './_test-constants.mjs'

const FIXTURE = 'player-with-cash-at-vb'
const VB_HUB = 'vonBraunCityAirport'
const ZUM_HUB = 'zumCityAirport'
const VB_SCENE = 'vonBraunCity'
const ZUM_SCENE = 'zumCity'
const BUY_LABEL = '购票'

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL(`?test=1&fixture=${FIXTURE}`, baseUrl).toString()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: VIEWPORT })
const page = await ctx.newPage()

const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => {
  if (m.type() !== 'error') return
  const line = `console.error: ${m.text()}`
  if (isExpectedTestModePortraitMissing(line)) return
  pageErrors.push(line)
})

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.getGameState === 'function'
    && typeof window.__uclife__?.listAirports === 'function'
    && typeof window.uclifeUI?.getState === 'function'
    && typeof window.__uclife__?.useScene?.getState === 'function'
    && typeof window.__uclife__?.useTransition?.getState === 'function',
  null,
  { timeout: BOOT_READY_TIMEOUT_MS },
)

const initialScene = await page.evaluate(() => window.__uclife__.getGameState().getScene().getId())
assert.equal(initialScene, VB_SCENE, `fixture must boot in ${VB_SCENE}, got ${initialScene}`)

// Pull expected arrival placements from the same source the runtime reads.
const airports = await page.evaluate(() => window.__uclife__.listAirports())
const arrivalByHub = Object.fromEntries(
  airports.filter((a) => a.placement).map((a) => [a.hubId, a.placement.arrivalPx]),
)
const zumArrival = arrivalByHub[ZUM_HUB]
const vbArrival = arrivalByHub[VB_HUB]
assert.ok(zumArrival, `${ZUM_HUB} placement missing from listAirports`)
assert.ok(vbArrival, `${VB_HUB} placement missing from listAirports`)

async function flyVia(fromHubId, expectedSceneId, expectedArrivalPx, label) {
  await page.evaluate((hubId) => window.uclifeUI.getState().openFlight(hubId), fromHubId)

  // DOM-readiness wait — React commit, not sim state.
  await page.waitForSelector('.transit-terminal-go', { state: 'visible', timeout: DOM_COMMIT_TIMEOUT_MS })

  const btnText = await page.locator('.transit-terminal-go').first().textContent()
  assert.equal(btnText, BUY_LABEL,
    `${label}: expected buy button '${BUY_LABEL}', got '${btnText}' (likely insufficient funds)`)

  await page.click('.transit-terminal-go')

  // The transition is RAF-driven (browser state), not sim state — frozen
  // clock doesn't affect requestAnimationFrame. Wait on the cover element
  // detaching AND on the scene id flipping; both are browser-side mutations
  // settled by the time the in-fade unmounts the overlay.
  await page.waitForSelector('.transition-overlay', { state: 'detached', timeout: DOM_COMMIT_TIMEOUT_MS })
  await page.waitForFunction(
    (sceneId) => window.__uclife__.useScene.getState().activeId === sceneId
      && window.__uclife__.useTransition.getState().inProgress === false,
    expectedSceneId,
    { timeout: DOM_COMMIT_TIMEOUT_MS },
  )

  const after = await page.evaluate(() => {
    const gs = window.__uclife__.getGameState()
    return {
      activeId: gs.getScene().getId(),
      pos: gs.getPlayerCharacter().getPosition(),
    }
  })
  assert.equal(after.activeId, expectedSceneId,
    `${label}: scene id ${after.activeId} (want ${expectedSceneId})`)
  assert.equal(after.pos.scene, expectedSceneId,
    `${label}: player.position.scene ${after.pos.scene} (want ${expectedSceneId})`)
  assert.equal(after.pos.x, expectedArrivalPx.x,
    `${label}: player.x ${after.pos.x} (want ${expectedArrivalPx.x})`)
  assert.equal(after.pos.y, expectedArrivalPx.y,
    `${label}: player.y ${after.pos.y} (want ${expectedArrivalPx.y})`)
}

await flyVia(VB_HUB, ZUM_SCENE, zumArrival, 'leg 1 (vonBraunCity → zumCity)')
await flyVia(ZUM_HUB, VB_SCENE, vbArrival, 'leg 2 (zumCity → vonBraunCity)')

assert.equal(pageErrors.length, 0,
  `page error(s) during test:\n${pageErrors.map((e) => '  ' + e).join('\n')}`)

console.log('OK — check-scene-swap (deterministic):')
console.log(`  leg 1: ${VB_SCENE} → ${ZUM_SCENE} arrival=${JSON.stringify(zumArrival)}`)
console.log(`  leg 2: ${ZUM_SCENE} → ${VB_SCENE} arrival=${JSON.stringify(vbArrival)}`)

await browser.close()
