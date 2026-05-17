// Phase 6 deterministic migration of the orbital-lift smoke. Verifies:
//   1. The VB orbital-lift kiosk spawns at the spaceport with the right
//      liftId + fare + duration from orbital-lifts.json5.
//   2. The Granada drydock scene spawns its paired lift kiosk and a
//      state-owned `hangarDrydock` facility with tier='drydock' and
//      slotCapacity matching facility-types.json5.
//   3. The cross-scene transit runs: charges fare, advances the clock by
//      durationMin, and migrates the player to Granada — listHangars on
//      the new active scene returns the drydock.
//   4. Opening NPCDialog on the drydock manager and clicking the
//      hangarManager branch surfaces the authored drydock-tier readout.
//
// Migrated to the deterministic stack: ?test=1&fixture=player-with-cash-at-vb,
// frozen clock, real Playwright click on the dialog option, no waitForTimeout.

import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import {
  BOOT_READY_TIMEOUT_MS, DOM_COMMIT_TIMEOUT_MS, VIEWPORT,
  isExpectedTestModePortraitMissing,
} from './_test-constants.mjs'

const FIXTURE = 'player-with-cash-at-vb'
const LIFT_ID = 'vonBraunGranadaLift'
const FROM_SCENE = 'vonBraunCity'
const TO_SCENE = 'granadaDrydock'
const LIFT_FARE = 500
const LIFT_DURATION_MIN = 90
const MS_PER_MINUTE = 60_000
const DRYDOCK_TYPE_ID = 'hangarDrydock'
const EXPECTED_CAPITAL_SLOTS = 4
const EXPECTED_SMALL_CRAFT_SLOTS = 12

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
    && typeof window.__uclife__?.listOrbitalLifts === 'function'
    && typeof window.__uclife__?.runOrbitalLift === 'function'
    && typeof window.__uclife__?.orbitalLiftCatalog === 'function'
    && typeof window.__uclife__?.listHangars === 'function'
    && typeof window.__uclife__?.hangarManagerEntity === 'function'
    && typeof window.__uclife__?.fillJobVacancies === 'function',
  null,
  { timeout: BOOT_READY_TIMEOUT_MS },
)

const initialScene = await page.evaluate(() => window.__uclife__.getGameState().getScene().getId())
assert.equal(initialScene, FROM_SCENE, `fixture must boot in ${FROM_SCENE}, got ${initialScene}`)

// 1. Catalog defines exactly the VB ↔ Granada lift; kiosks land in both scenes.
const catalog = await page.evaluate(() => window.__uclife__.orbitalLiftCatalog())
assert.equal(catalog.length, 1, `expected 1 orbital lift, found ${catalog.length}`)
const vbLift = catalog.find((l) => l.id === LIFT_ID)
assert.ok(vbLift, `${LIFT_ID} missing from orbitalLiftCatalog`)
assert.equal(vbLift.sceneIdA, FROM_SCENE,
  `vbLift.sceneIdA=${vbLift.sceneIdA} (want ${FROM_SCENE})`)
assert.equal(vbLift.sceneIdB, TO_SCENE,
  `vbLift.sceneIdB=${vbLift.sceneIdB} (want ${TO_SCENE})`)
assert.equal(vbLift.durationMin, LIFT_DURATION_MIN,
  `vbLift.durationMin=${vbLift.durationMin} (want ${LIFT_DURATION_MIN})`)
assert.equal(vbLift.fare, LIFT_FARE, `vbLift.fare=${vbLift.fare} (want ${LIFT_FARE})`)

const vbKiosks = await page.evaluate(
  (sceneId) => window.__uclife__.listOrbitalLifts(sceneId), FROM_SCENE,
)
assert.equal(vbKiosks.length, 1,
  `VB scene expected 1 lift kiosk, found ${vbKiosks.length}`)
assert.equal(vbKiosks[0].destSceneId, TO_SCENE,
  `VB kiosk destSceneId=${vbKiosks[0].destSceneId} (want ${TO_SCENE})`)

const granadaKiosks = await page.evaluate(
  (sceneId) => window.__uclife__.listOrbitalLifts(sceneId), TO_SCENE,
)
assert.equal(granadaKiosks.length, 1,
  `Granada scene expected 1 lift kiosk, found ${granadaKiosks.length}`)
assert.equal(granadaKiosks[0].destSceneId, FROM_SCENE,
  `Granada kiosk destSceneId=${granadaKiosks[0].destSceneId} (want ${FROM_SCENE})`)

// 2. Capture pre-transit money + clock through the deterministic facade.
const pre = await page.evaluate(() => ({
  money: window.__uclife__.getGameState().getPlayerCharacter().getResource('Money'),
  clockMs: window.__uclife__.useClock.getState().gameDate.getTime(),
  sceneId: window.__uclife__.getGameState().getScene().getId(),
}))

// 3. Run the transit. runOrbitalLift mirrors the diegetic interaction path
//    (charges fare, advances clock by durationMin, migrates player).
const arrivedSceneId = await page.evaluate(
  (liftId) => window.__uclife__.runOrbitalLift(liftId), LIFT_ID,
)
assert.equal(arrivedSceneId, TO_SCENE,
  `runOrbitalLift returned ${arrivedSceneId} (want ${TO_SCENE})`)

const post = await page.evaluate(() => ({
  money: window.__uclife__.getGameState().getPlayerCharacter().getResource('Money'),
  clockMs: window.__uclife__.useClock.getState().gameDate.getTime(),
  sceneId: window.__uclife__.getGameState().getScene().getId(),
}))

assert.equal(post.sceneId, TO_SCENE, `post.sceneId=${post.sceneId} (want ${TO_SCENE})`)
assert.equal(pre.money - post.money, LIFT_FARE,
  `fare delta=${pre.money - post.money} (want ${LIFT_FARE}); pre=${pre.money} post=${post.money}`)
assert.equal(post.clockMs - pre.clockMs, LIFT_DURATION_MIN * MS_PER_MINUTE,
  `clock delta=${post.clockMs - pre.clockMs}ms (want ${LIFT_DURATION_MIN * MS_PER_MINUTE}ms)`)

// 4. listHangars on the Granada active scene returns the drydock.
const hangars = await page.evaluate(() => window.__uclife__.listHangars())
assert.equal(hangars.length, 1, `Granada scene expected 1 hangar, found ${hangars.length}`)
const drydock = hangars.find((h) => h.typeId === DRYDOCK_TYPE_ID)
assert.ok(drydock, `${DRYDOCK_TYPE_ID} missing from listHangars in Granada`)
assert.equal(drydock.tier, 'drydock', `drydock.tier=${drydock.tier} (want drydock)`)
assert.equal(drydock.slotCapacity.capital, EXPECTED_CAPITAL_SLOTS,
  `drydock.slotCapacity.capital=${drydock.slotCapacity.capital} (want ${EXPECTED_CAPITAL_SLOTS})`)
assert.equal(drydock.slotCapacity.smallCraft, EXPECTED_SMALL_CRAFT_SLOTS,
  `drydock.slotCapacity.smallCraft=${drydock.slotCapacity.smallCraft} (want ${EXPECTED_SMALL_CRAFT_SLOTS})`)
assert.equal(drydock.ownerKind, 'state', `drydock.ownerKind=${drydock.ownerKind} (want state)`)
assert.ok(drydock.workerCount >= 1, `drydock workerCount=${drydock.workerCount} (want >= 1)`)

// 5. Seat manager + workers, then click the hangarManager dialog branch.
const filled = await page.evaluate(
  () => window.__uclife__.fillJobVacancies(['hangar_manager', 'hangar_worker']),
)
assert.ok(Array.isArray(filled), `fillJobVacancies did not return an array: ${JSON.stringify(filled)}`)

const after = await page.evaluate(() => window.__uclife__.listHangars())
const drydockAfter = after.find((h) => h.buildingKey === drydock.buildingKey)
assert.ok(drydockAfter?.manager, `drydock manager seat still empty after fillJobVacancies`)
assert.ok(drydockAfter.manager.occupantName,
  `drydock manager occupant has no Character name: ${JSON.stringify(drydockAfter.manager)}`)

const opened = await page.evaluate((buildingKey) => {
  const manager = window.__uclife__.hangarManagerEntity(buildingKey)
  if (!manager) return false
  window.uclifeUI.getState().setDialogNPC(manager)
  return true
}, drydock.buildingKey)
assert.ok(opened, `could not open NPCDialog for drydock manager`)

await page.waitForSelector('button.dialog-option', { timeout: DOM_COMMIT_TIMEOUT_MS })
await page.click('button.dialog-option:has-text("机库状况")')
await page.waitForSelector('section[data-dialogue-node="hangarManager"]', { timeout: DOM_COMMIT_TIMEOUT_MS })

const text = await page.evaluate(() => {
  const node = document.querySelector('section[data-dialogue-node="hangarManager"]')
  return node?.textContent ?? ''
})
assert.ok(text.includes('0 / 4'),
  `manager panel missing 0/4 capital readout; got: ${text.replace(/\s+/g, ' ').slice(0, 200)}`)
assert.ok(text.includes('0 / 12'),
  `manager panel missing 0/12 smallCraft readout; got: ${text.replace(/\s+/g, ' ').slice(0, 200)}`)
assert.ok(text.includes('船坞') || text.includes('轨道'),
  `manager panel missing drydock tier label; got: ${text.replace(/\s+/g, ' ').slice(0, 200)}`)

assert.equal(pageErrors.length, 0,
  `page error(s) during test:\n${pageErrors.map((e) => '  ' + e).join('\n')}`)

console.log('OK — check-orbital-lift (deterministic):')
console.log(`  catalog=${vbLift.id} fare=${vbLift.fare}¥ duration=${vbLift.durationMin}min`)
console.log(`  transit: ${pre.sceneId} → ${post.sceneId}  money=${pre.money}→${post.money}  Δclock=${post.clockMs - pre.clockMs}ms`)
console.log(`  drydock=${drydock.buildingKey} tier=${drydock.tier} capital=${drydock.slotCapacity.capital} small=${drydock.slotCapacity.smallCraft}`)
console.log(`  drydock manager=${drydockAfter.manager.occupantName}`)

await browser.close()
