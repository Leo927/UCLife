// Phase 6 deterministic migration of the hangar smoke. Verifies:
//   1. The Von Braun state hangar spawns with the Hangar trait carrying
//      tier='surface' and slotCapacity matching facility-types.json5.
//   2. The hangar is state-owned and the realtor never lists it.
//   3. The hangar manager seat is BT-claimable: fillJobVacancies seats it
//      with a Character occupant.
//   4. Opening NPCDialog on the manager and clicking the hangarManager
//      branch surfaces the authored capacity readout.
//
// Migrated to the deterministic stack: ?test=1&fixture=minimal-player-only,
// frozen clock, real Playwright clicks on dialog buttons, no waitForTimeout.

import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import {
  BOOT_READY_TIMEOUT_MS, DOM_COMMIT_TIMEOUT_MS, VIEWPORT,
  isExpectedTestModePortraitMissing,
} from './_test-constants.mjs'

const FIXTURE = 'minimal-player-only'
const HANGAR_TYPE_ID = 'hangarSurface'
const EXPECTED_MS_SLOTS = 4
const EXPECTED_SMALL_CRAFT_SLOTS = 4
const EXPECTED_TIER = 'surface'
const EXPECTED_OWNER_KIND = 'state'

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
    && typeof window.__uclife__?.listHangars === 'function'
    && typeof window.__uclife__?.hangarManagerEntity === 'function'
    && typeof window.__uclife__?.fillJobVacancies === 'function'
    && typeof window.__uclife__?.realtorListings === 'function',
  null,
  { timeout: BOOT_READY_TIMEOUT_MS },
)

const scene = await page.evaluate(() => window.__uclife__.getGameState().getScene().getId())
assert.equal(scene, 'vonBraunCity', `fixture must boot in vonBraunCity, got ${scene}`)

// 1. Hangar spawned with the right facility shape.
const hangars = await page.evaluate(() => window.__uclife__.listHangars())
assert.equal(hangars.length, 1, `expected 1 hangar in vonBraunCity, found ${hangars.length}`)
const vb = hangars[0]
assert.equal(vb.typeId, HANGAR_TYPE_ID, `hangar.typeId=${vb.typeId} (want ${HANGAR_TYPE_ID})`)
assert.equal(vb.tier, EXPECTED_TIER, `hangar.tier=${vb.tier} (want ${EXPECTED_TIER})`)
assert.equal(vb.slotCapacity.ms, EXPECTED_MS_SLOTS,
  `hangar.slotCapacity.ms=${vb.slotCapacity.ms} (want ${EXPECTED_MS_SLOTS})`)
assert.equal(vb.slotCapacity.smallCraft, EXPECTED_SMALL_CRAFT_SLOTS,
  `hangar.slotCapacity.smallCraft=${vb.slotCapacity.smallCraft} (want ${EXPECTED_SMALL_CRAFT_SLOTS})`)
assert.equal(vb.ownerKind, EXPECTED_OWNER_KIND,
  `hangar.ownerKind=${vb.ownerKind} (want ${EXPECTED_OWNER_KIND})`)
assert.ok(vb.workerCount >= 1, `hangar workerCount=${vb.workerCount} (want >= 1)`)

// 2. Realtor never lists it — stateLocked filter is honored.
const listings = await page.evaluate(() => window.__uclife__.realtorListings())
const hangarListed = listings.find((l) => l.typeId === HANGAR_TYPE_ID)
assert.equal(hangarListed, undefined,
  `hangar appeared on realtor — stateLocked filter regression: ${JSON.stringify(hangarListed)}`)

// 3. fillJobVacancies seats the manager + workers deterministically.
const filled = await page.evaluate(
  () => window.__uclife__.fillJobVacancies(['hangar_manager', 'hangar_worker']),
)
assert.ok(Array.isArray(filled), `fillJobVacancies did not return an array: ${JSON.stringify(filled)}`)

const after = await page.evaluate(() => window.__uclife__.listHangars())
const vbAfter = after.find((h) => h.buildingKey === vb.buildingKey)
assert.ok(vbAfter?.manager, `hangar manager seat still empty after fillJobVacancies`)
assert.ok(vbAfter.manager.occupantName,
  `hangar manager occupant has no Character name: ${JSON.stringify(vbAfter.manager)}`)

// 4. Open NPCDialog on the manager. Driving the store directly (not a
//    canvas click) is the established pattern in test mode — the playbook's
//    "Known gaps" item #3 calls this out as acceptable until a typed
//    hangar/dialog view lands. The CLICKS that mutate state (dialog option
//    + nested branch) still go through real Playwright input.
const opened = await page.evaluate((buildingKey) => {
  const manager = window.__uclife__.hangarManagerEntity(buildingKey)
  if (!manager) return false
  window.uclifeUI.getState().setDialogNPC(manager)
  return true
}, vb.buildingKey)
assert.ok(opened, `could not open NPCDialog for hangar manager`)

await page.waitForSelector('button.dialog-option', { timeout: DOM_COMMIT_TIMEOUT_MS })

await page.click('button.dialog-option:has-text("机库状况")')

await page.waitForSelector('section[data-dialogue-node="hangarManager"]', { timeout: DOM_COMMIT_TIMEOUT_MS })

const text = await page.evaluate(() => {
  const node = document.querySelector('section[data-dialogue-node="hangarManager"]')
  return node?.textContent ?? ''
})
assert.ok(text.includes('MS 泊位'),
  `manager panel missing MS slot label; got: ${text.replace(/\s+/g, ' ').slice(0, 200)}`)
assert.ok(text.includes('小艇泊位'),
  `manager panel missing smallCraft slot label; got: ${text.replace(/\s+/g, ' ').slice(0, 200)}`)
assert.ok(text.includes('0 / 4'),
  `manager panel missing 0/4 capacity readout; got: ${text.replace(/\s+/g, ' ').slice(0, 200)}`)
assert.ok(text.includes('地面机库'),
  `manager panel missing surface tier label; got: ${text.replace(/\s+/g, ' ').slice(0, 200)}`)

assert.equal(pageErrors.length, 0,
  `page error(s) during test:\n${pageErrors.map((e) => '  ' + e).join('\n')}`)

console.log('OK — check-hangar (deterministic):')
console.log(`  hangar=${vb.buildingKey} tier=${vb.tier} ms=${vb.slotCapacity.ms} small=${vb.slotCapacity.smallCraft}`)
console.log(`  manager=${vbAfter.manager.occupantName} workers=${vb.workerCount}`)
console.log(`  dialog readout: ${text.replace(/\s+/g, ' ').slice(0, 120)}`)

await browser.close()
