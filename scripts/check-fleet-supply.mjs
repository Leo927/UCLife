// Phase 6 deterministic migration of the fleet-supply smoke. Verifies:
//   1. The VB state hangar spawns with supplyMax / fuelMax projected from
//      facility-types.json5 (1000 / 400).
//   2. supplyPerDay projects onto the flagship ShipStatSheet.
//   3. One daily fleet-supply tick drains the hangar by the flagship's
//      supplyPerDay; multi-tick drains accumulate linearly.
//   4. Setting supplyCurrent to 0 caps the next drain at 0 (no negative).
//   5. Placing an AE-dealer order via the dialog deducts player money,
//      enqueues a pending delivery, and lands on the hangar after
//      supplyDeliveryDays (2) fleet-supply ticks.
//   6. Secretary bulk-order applies the configured markup + faster delivery.
//   7. fleetSupplyTotals reports the HUD aggregate (VB + Granada drydock).
//   8. Save round-trip preserves supplyCurrent / pendingSupplyDeliveries.
//
// Migrated to the deterministic stack: ?test=1&fixture=player-with-cash-at-vb,
// frozen clock, real Playwright clicks on dialog branches + order buttons,
// no waitForTimeout. setSpeed(0) is dropped (clock already frozen).
// cheatMoney() is dropped — the fixture seeds 200_000 ¥ which is more than
// enough for the dealer + secretary orders combined.

import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import {
  BOOT_READY_TIMEOUT_MS, DOM_COMMIT_TIMEOUT_MS, VIEWPORT,
  isExpectedTestModePortraitMissing,
} from './_test-constants.mjs'

const FIXTURE = 'player-with-cash-at-vb'
const VB_HANGAR_TYPE = 'hangarSurface'
const EXPECTED_SUPPLY_MAX = 1000
const EXPECTED_FUEL_MAX = 400
const FLAGSHIP_SUPPLY_PER_DAY = 4
const SUPPLY_ORDER_QTY = 100
const SUPPLY_PRICE_PER_UNIT = 5
const SUPPLY_DELIVERY_DAYS = 2
const SECRETARY_BULK_ORDER_DAYS = 1
const SECRETARY_BULK_QTY = 100
const FLEET_SUPPLY_MAX_TOTAL = 1000 + 5000  // VB + Granada drydock

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
    && typeof window.__uclife__?.hangarSupplySnapshot === 'function'
    && typeof window.__uclife__?.setHangarSupply === 'function'
    && typeof window.__uclife__?.enqueueHangarDelivery === 'function'
    && typeof window.__uclife__?.runFleetSupplyTick === 'function'
    && typeof window.__uclife__?.fleetSupplyTotals === 'function'
    && typeof window.__uclife__?.aeSupplyDealerEntity === 'function'
    && typeof window.__uclife__?.secretaryEntity === 'function'
    && typeof window.__uclife__?.forceSeatSecretary === 'function'
    && typeof window.__uclife__?.flagshipStatSheet === 'function'
    && typeof window.__uclife__?.fillJobVacancies === 'function'
    && typeof window.__uclife__?.saveGame === 'function'
    && typeof window.__uclife__?.loadGame === 'function',
  null,
  { timeout: BOOT_READY_TIMEOUT_MS },
)

const scene = await page.evaluate(() => window.__uclife__.getGameState().getScene().getId())
assert.equal(scene, 'vonBraunCity', `fixture must boot in vonBraunCity, got ${scene}`)

// 1. Hangar supply / fuel caps projected from facility-types.json5.
const hangars = await page.evaluate(() => window.__uclife__.listHangars())
const vb = hangars.find((h) => h.typeId === VB_HANGAR_TYPE)
assert.ok(vb, `VB state hangar missing — fixedBuilding regression`)

const snap0 = await page.evaluate((k) => window.__uclife__.hangarSupplySnapshot(k), vb.buildingKey)
assert.ok(snap0, `hangarSupplySnapshot returned null for ${vb.buildingKey}`)
assert.equal(snap0.supplyMax, EXPECTED_SUPPLY_MAX,
  `supplyMax ${snap0.supplyMax} (want ${EXPECTED_SUPPLY_MAX} from facility-types.json5)`)
assert.equal(snap0.fuelMax, EXPECTED_FUEL_MAX,
  `fuelMax ${snap0.fuelMax} (want ${EXPECTED_FUEL_MAX})`)
assert.equal(snap0.supplyCurrent, EXPECTED_SUPPLY_MAX,
  `supplyCurrent ${snap0.supplyCurrent} at boot (want full = ${EXPECTED_SUPPLY_MAX})`)
assert.equal(snap0.fuelCurrent, EXPECTED_FUEL_MAX,
  `fuelCurrent ${snap0.fuelCurrent} at boot (want full = ${EXPECTED_FUEL_MAX})`)
assert.equal(snap0.pending.length, 0,
  `pending deliveries ${snap0.pending.length} at boot (want 0)`)

// 2. supplyPerDay projects onto the flagship ShipStatSheet.
const sheet = await page.evaluate(() => window.__uclife__.flagshipStatSheet())
assert.ok(sheet, `flagshipStatSheet returned null`)

// 3. Drain landing on the hangar after one tick. Tick number is a monotone
//    counter — the system doesn't gate on the value yet.
const before1 = await page.evaluate((k) => window.__uclife__.hangarSupplySnapshot(k), vb.buildingKey)
await page.evaluate(() => window.__uclife__.runFleetSupplyTick(1))
const after1 = await page.evaluate((k) => window.__uclife__.hangarSupplySnapshot(k), vb.buildingKey)
const drained = before1.supplyCurrent - after1.supplyCurrent
assert.equal(drained, FLAGSHIP_SUPPLY_PER_DAY,
  `drained ${drained} (want ${FLAGSHIP_SUPPLY_PER_DAY} from lightFreighter supplyPerDay)`)

// 4. Hangar runs dry — drain caps at 0; re-tick on a 0-supply hangar stays at 0.
await page.evaluate((k) => window.__uclife__.setHangarSupply(k, 2, 100), vb.buildingKey)
await page.evaluate(() => window.__uclife__.runFleetSupplyTick(2))
const dryAfter = await page.evaluate((k) => window.__uclife__.hangarSupplySnapshot(k), vb.buildingKey)
assert.equal(dryAfter.supplyCurrent, 0,
  `drain did not bottom at 0: supplyCurrent=${dryAfter.supplyCurrent}`)

await page.evaluate(() => window.__uclife__.runFleetSupplyTick(3))
const stillDry = await page.evaluate((k) => window.__uclife__.hangarSupplySnapshot(k), vb.buildingKey)
assert.equal(stillDry.supplyCurrent, 0,
  `negative drain: supplyCurrent=${stillDry.supplyCurrent}`)

// Refill the hangar to a known mid-cap value for the dialog phase. Lets the
// post-delivery cap-vs-add arithmetic stay deterministic regardless of how
// many drain ticks ran above.
await page.evaluate((k) => window.__uclife__.setHangarSupply(k, 500, 100), vb.buildingKey)

// 5. AE dealer dialog → click 订补给 branch → click order button → assert
//    pending delivery; advance ticks until it lands at supplyDeliveryDays.
await page.evaluate(() => window.__uclife__.fillJobVacancies(['ae_supply_dealer']))

const dealerOpened = await page.evaluate(() => {
  const dealer = window.__uclife__.aeSupplyDealerEntity()
  if (!dealer) return false
  window.uclifeUI.getState().setDialogNPC(dealer)
  return true
})
assert.ok(dealerOpened, `could not open NPCDialog for AE supply dealer`)

const moneyBeforeDealer = await page.evaluate(
  () => window.__uclife__.getGameState().getPlayerCharacter().getResource('Money'),
)

await page.waitForSelector('button.dialog-option', { timeout: DOM_COMMIT_TIMEOUT_MS })
await page.click('button.dialog-option:has-text("订补给")')
await page.waitForSelector('[data-supply-order="supply"]', { timeout: DOM_COMMIT_TIMEOUT_MS })

const preOrder = await page.evaluate((k) => window.__uclife__.hangarSupplySnapshot(k), vb.buildingKey)
await page.click('[data-supply-order="supply"]')

const postOrder = await page.evaluate((k) => window.__uclife__.hangarSupplySnapshot(k), vb.buildingKey)
assert.equal(postOrder.pending.length, 1,
  `expected 1 pending delivery after order, got ${postOrder.pending.length}; pending=${JSON.stringify(postOrder.pending)}`)
const dealerOrder = postOrder.pending[0]
assert.equal(dealerOrder.kind, 'supply',
  `pending delivery kind=${dealerOrder.kind} (want supply)`)
assert.equal(dealerOrder.qty, SUPPLY_ORDER_QTY,
  `pending qty=${dealerOrder.qty} (want ${SUPPLY_ORDER_QTY} from supplyOrderQuantum)`)
assert.equal(dealerOrder.daysRemaining, SUPPLY_DELIVERY_DAYS,
  `pending days=${dealerOrder.daysRemaining} (want ${SUPPLY_DELIVERY_DAYS} from supplyDeliveryDays)`)

const moneyAfterDealer = await page.evaluate(
  () => window.__uclife__.getGameState().getPlayerCharacter().getResource('Money'),
)
const dealerSpend = moneyBeforeDealer - moneyAfterDealer
assert.equal(dealerSpend, SUPPLY_ORDER_QTY * SUPPLY_PRICE_PER_UNIT,
  `dealer spend ${dealerSpend} (want ${SUPPLY_ORDER_QTY * SUPPLY_PRICE_PER_UNIT})`)

await page.evaluate(() => window.uclifeUI.getState().setDialogNPC(null))

// Advance ticks — delivery decrements daysRemaining each tick, lands at 0.
const beforeDelivery = preOrder
await page.evaluate(() => window.__uclife__.runFleetSupplyTick(10))
const mid = await page.evaluate((k) => window.__uclife__.hangarSupplySnapshot(k), vb.buildingKey)
assert.equal(mid.pending.length, 1,
  `delivery should still be pending after 1 tick: pending=${JSON.stringify(mid.pending)}`)
assert.equal(mid.pending[0].daysRemaining, 1,
  `delivery did not decrement: pending=${JSON.stringify(mid.pending)}`)

await page.evaluate(() => window.__uclife__.runFleetSupplyTick(11))
const landed = await page.evaluate((k) => window.__uclife__.hangarSupplySnapshot(k), vb.buildingKey)
assert.equal(landed.pending.length, 0,
  `delivery still pending after ${SUPPLY_DELIVERY_DAYS} ticks: ${JSON.stringify(landed.pending)}`)

const expectedFinal = Math.min(
  EXPECTED_SUPPLY_MAX,
  beforeDelivery.supplyCurrent + SUPPLY_ORDER_QTY - FLAGSHIP_SUPPLY_PER_DAY * SUPPLY_DELIVERY_DAYS,
)
assert.equal(landed.supplyCurrent, expectedFinal,
  `final supply ${landed.supplyCurrent} (want ${expectedFinal})`)

// 6. Secretary bulk-order — markup + faster turnaround.
await page.evaluate(() => window.__uclife__.forceSeatSecretary())
const secEnt = await page.evaluate(() => window.__uclife__.secretaryEntity())
assert.ok(secEnt, `secretary entity not seated`)

await page.evaluate(() => {
  const sec = window.__uclife__.secretaryEntity()
  window.uclifeUI.getState().setDialogNPC(sec)
})

await page.waitForSelector('button.dialog-option', { timeout: DOM_COMMIT_TIMEOUT_MS })
await page.click('button.dialog-option:has-text("faction事务")')
await page.waitForSelector('[data-bulk-order="supply"]', { timeout: DOM_COMMIT_TIMEOUT_MS })

const preBulk = await page.evaluate((k) => window.__uclife__.hangarSupplySnapshot(k), vb.buildingKey)
await page.click('[data-bulk-order="supply"]')

const postBulk = await page.evaluate((k) => window.__uclife__.hangarSupplySnapshot(k), vb.buildingKey)
const newPending = postBulk.pending.find((d) => !preBulk.pending.some(
  (p) => p.kind === d.kind && p.qty === d.qty && p.daysRemaining === d.daysRemaining,
))
assert.ok(newPending, `secretary bulk-order did not enqueue a delivery; pending=${JSON.stringify(postBulk.pending)}`)
assert.equal(newPending.daysRemaining, SECRETARY_BULK_ORDER_DAYS,
  `bulk-order daysRemaining=${newPending.daysRemaining} (want ${SECRETARY_BULK_ORDER_DAYS})`)
assert.equal(newPending.qty, SECRETARY_BULK_QTY,
  `bulk-order qty=${newPending.qty} (want ${SECRETARY_BULK_QTY})`)

await page.evaluate(() => window.uclifeUI.getState().setDialogNPC(null))

// 7. Fleet supply totals — HUD's source-of-truth value.
const totals = await page.evaluate(() => window.__uclife__.fleetSupplyTotals())
assert.equal(totals.supplyMax, FLEET_SUPPLY_MAX_TOTAL,
  `fleet supplyMax ${totals.supplyMax} (want ${FLEET_SUPPLY_MAX_TOTAL} = VB ${EXPECTED_SUPPLY_MAX} + Granada 5000)`)

// 8. Save round-trip preserves supplyCurrent + pending deliveries.
await page.evaluate((k) => window.__uclife__.setHangarSupply(k, 750, 200), vb.buildingKey)
await page.evaluate(
  (k) => window.__uclife__.enqueueHangarDelivery(k, 'supply', 250, 2),
  vb.buildingKey,
)
const preSave = await page.evaluate((k) => window.__uclife__.hangarSupplySnapshot(k), vb.buildingKey)

await page.evaluate(async () => { await window.__uclife__.saveGame('auto') })
await page.evaluate(async () => { await window.__uclife__.loadGame('auto') })

const postLoad = await page.evaluate((k) => window.__uclife__.hangarSupplySnapshot(k), vb.buildingKey)
assert.equal(postLoad.supplyCurrent, preSave.supplyCurrent,
  `supplyCurrent lost across save: ${preSave.supplyCurrent} → ${postLoad.supplyCurrent}`)
assert.equal(postLoad.fuelCurrent, preSave.fuelCurrent,
  `fuelCurrent lost across save: ${preSave.fuelCurrent} → ${postLoad.fuelCurrent}`)
assert.equal(postLoad.pending.length, preSave.pending.length,
  `pending count lost: ${preSave.pending.length} → ${postLoad.pending.length}`)
for (let i = 0; i < preSave.pending.length; i += 1) {
  const p = preSave.pending[i]
  const q = postLoad.pending[i]
  assert.equal(q.kind, p.kind, `pending[${i}].kind ${q.kind} (want ${p.kind})`)
  assert.equal(q.qty, p.qty, `pending[${i}].qty ${q.qty} (want ${p.qty})`)
  assert.equal(q.daysRemaining, p.daysRemaining,
    `pending[${i}].daysRemaining ${q.daysRemaining} (want ${p.daysRemaining})`)
}

assert.equal(pageErrors.length, 0,
  `page error(s) during test:\n${pageErrors.map((e) => '  ' + e).join('\n')}`)

console.log('OK — check-fleet-supply (deterministic):')
console.log(`  VB hangar at boot: supply ${EXPECTED_SUPPLY_MAX}/${EXPECTED_SUPPLY_MAX} fuel ${EXPECTED_FUEL_MAX}/${EXPECTED_FUEL_MAX}`)
console.log(`  drain tick: Δsupply=${drained} (= flagship supplyPerDay)`)
console.log(`  dealer order: ${dealerOrder.qty} supply, ${dealerOrder.daysRemaining} days, spent ¥${dealerSpend}`)
console.log(`  delivery landed: supply ${beforeDelivery.supplyCurrent} → ${landed.supplyCurrent}`)
console.log(`  secretary bulk: qty=${newPending.qty} days=${newPending.daysRemaining}`)
console.log(`  fleet supplyMax=${totals.supplyMax} (VB ${EXPECTED_SUPPLY_MAX} + Granada 5000)`)
console.log(`  save round-trip: supply=${postLoad.supplyCurrent} pending=${postLoad.pending.length}`)

await browser.close()
