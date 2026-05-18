import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import { BOOT_READY_TIMEOUT_MS, SAVE_LOAD_READY_TIMEOUT_MS, VIEWPORT } from './_test-constants.mjs'

// Phase 6.2.C1 light-hull buy smoke — migrated to the deterministic
// API (Phase 6, Category A). The sim clock is frozen by ?test=1; every
// time-advancing verb (runShipDeliveryTick) is a tick-targeted call.
//
// Coverage:
//   1. AE Von Braun ship-sales rep seated at the airport sales desk after
//      fillJobVacancies.
//   2. enqueueShipDelivery refuses gracefully when the target hangar key
//      is unknown.
//   3. enqueueShipDelivery records a pending row with the configured
//      2-day lead time, in_transit by default.
//   4. runShipDeliveryTick(arrivalDay) flips status to 'arrived'.
//   5. receiveShipDelivery spawns a new Ship entity in the fleet, sets
//      dockedAtPoiId to the hangar's POI, increments slot occupancy, and
//      pops the row from the queue.
//   6. receiveShipDelivery returns reason='not_arrived' for an in-transit
//      row, and reason='no_row' for an out-of-bounds index.
//   7. Save round-trip preserves a pending delivery row exactly.
//   8. The no-slot path fires when capacity is filled.

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1', baseUrl).toString()

const SMALL_HULL_LEAD_DAYS = 2
const ORDER_DAY_INITIAL = 1
const ARRIVAL_DAY_INITIAL = ORDER_DAY_INITIAL + SMALL_HULL_LEAD_DAYS
const ORDER_DAY_SAVE_RT = 5
const NO_SLOT_TICK_DAY = 100
const NO_SLOT_ENQUEUE_DAY = 50
const NO_SLOT_FINAL_DAY = 101
const SLOT_KEY = 'smallCraft'
const ORDER_DAY_FOR_NO_SLOT_PROBE = 100

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: VIEWPORT })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })

await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.listHangars === 'function'
    && typeof window.__uclife__?.fillJobVacancies === 'function'
    && typeof window.__uclife__?.deliverySnapshot === 'function'
    && typeof window.__uclife__?.enqueueShipDelivery === 'function'
    && typeof window.__uclife__?.runShipDeliveryTick === 'function'
    && typeof window.__uclife__?.receiveShipDelivery === 'function'
    && typeof window.__uclife__?.hangarOccupancy === 'function'
    && typeof window.__uclife__?.listShipsInFleet === 'function'
    && typeof window.__uclife__?.saveGame === 'function'
    && typeof window.__uclife__?.loadGame === 'function',
  null,
  { timeout: BOOT_READY_TIMEOUT_MS },
)

await page.evaluate(() => window.__uclife__.fillJobVacancies(
  ['ae_ship_sales_vb', 'hangar_manager', 'hangar_worker'],
))

const salesSeated = await page.evaluate(() =>
  window.__uclife__.fillJobVacancies(['ae_ship_sales_vb']),
)
assert.ok(Array.isArray(salesSeated),
  `fillJobVacancies(ae_ship_sales_vb) returned non-array: ${JSON.stringify(salesSeated)}`)
assert.ok(salesSeated[0]?.ok,
  `ae_ship_sales_vb fill failed: ${JSON.stringify(salesSeated)}`)

const hangars = await page.evaluate(() => window.__uclife__.listHangars())
const vb = hangars.find((h) => h.typeId === 'hangarSurface')
assert.ok(vb, 'VB state hangar missing — 6.2.A regression')

const bad = await page.evaluate(
  ([orderDay, lead]) => window.__uclife__.enqueueShipDelivery(
    'bld-nonexistent-x-0', 'lunarMilitia', orderDay, lead,
  ),
  [ORDER_DAY_INITIAL, SMALL_HULL_LEAD_DAYS],
)
assert.equal(bad, null,
  `enqueueShipDelivery accepted bogus buildingKey: ${JSON.stringify(bad)}`)

const enq = await page.evaluate((arg) => window.__uclife__.enqueueShipDelivery(
  arg.k, 'lunarMilitia', arg.orderDay, arg.lead,
), { k: vb.buildingKey, orderDay: ORDER_DAY_INITIAL, lead: SMALL_HULL_LEAD_DAYS })
assert.ok(enq && enq.rowIndex === 0,
  `enqueueShipDelivery rowIndex unexpected: ${JSON.stringify(enq)}`)

const snap1 = await page.evaluate(() => window.__uclife__.deliverySnapshot())
assert.equal(snap1.length, 1, `deliverySnapshot length=${snap1.length} (want 1)`)
const row = snap1[0]
assert.equal(row.status, 'in_transit', `row.status=${row.status} (want 'in_transit')`)
assert.equal(row.shipClassId, 'lunarMilitia', `row.shipClassId=${row.shipClassId}`)
assert.equal(row.orderDay, ORDER_DAY_INITIAL, `row.orderDay=${row.orderDay}`)
assert.equal(row.arrivalDay, ARRIVAL_DAY_INITIAL,
  `row.arrivalDay=${row.arrivalDay} (want ${ARRIVAL_DAY_INITIAL})`)

const earlyRx = await page.evaluate(
  (k) => window.__uclife__.receiveShipDelivery(k, 0), vb.buildingKey,
)
assert.ok(earlyRx.ok === false && earlyRx.reason === 'not_arrived',
  `receive before arrival should refuse with not_arrived; got ${JSON.stringify(earlyRx)}`)

const tickRes = await page.evaluate(
  (d) => window.__uclife__.runShipDeliveryTick(d), ARRIVAL_DAY_INITIAL,
)
assert.ok(tickRes && tickRes.rowsArrived === 1,
  `runShipDeliveryTick(${ARRIVAL_DAY_INITIAL}) result unexpected: ${JSON.stringify(tickRes)}`)

const snap2 = await page.evaluate(() => window.__uclife__.deliverySnapshot())
assert.equal(snap2[0]?.status, 'arrived',
  `row.status after tick = ${snap2[0]?.status} (want 'arrived')`)

const occupancyBefore = await page.evaluate(
  (k) => window.__uclife__.hangarOccupancy(k), vb.buildingKey,
)
const fleetBefore = await page.evaluate(() => window.__uclife__.listShipsInFleet())
const rx = await page.evaluate(
  (k) => window.__uclife__.receiveShipDelivery(k, 0), vb.buildingKey,
)
assert.ok(rx.ok, `receive returned not-ok: ${JSON.stringify(rx)}`)

const occupancyAfter = await page.evaluate(
  (k) => window.__uclife__.hangarOccupancy(k), vb.buildingKey,
)
const fleetAfter = await page.evaluate(() => window.__uclife__.listShipsInFleet())

const occBefore = occupancyBefore.occupied[SLOT_KEY] ?? 0
const occAfter = occupancyAfter.occupied[SLOT_KEY] ?? 0
assert.equal(occAfter, occBefore + 1,
  `slot occupancy delta ${SLOT_KEY}: ${occBefore} → ${occAfter} (want +1)`)
assert.equal(fleetAfter.length, fleetBefore.length + 1,
  `fleet count delta: ${fleetBefore.length} → ${fleetAfter.length} (want +1)`)

const newShip = fleetAfter.find((s) => !fleetBefore.some((b) => b.entityKey === s.entityKey))
assert.ok(newShip, 'could not isolate newly-spawned ship in fleet snapshot')
assert.equal(newShip.templateId, 'lunarMilitia',
  `new ship templateId=${newShip.templateId}`)
assert.equal(newShip.dockedAtPoiId, 'vonBraun',
  `new ship dockedAtPoiId=${newShip.dockedAtPoiId} (want vonBraun)`)
assert.ok(!newShip.isFlagship,
  'newly-delivered ship spawned with IsFlagshipMark — should be non-flagship')
assert.equal(newShip.hullCurrent, newShip.hullMax,
  `new ship hull not full: ${newShip.hullCurrent}/${newShip.hullMax}`)

const snap3 = await page.evaluate(() => window.__uclife__.deliverySnapshot())
assert.equal(snap3.length, 0, `pending after receive: ${snap3.length} rows (want 0)`)

const oob = await page.evaluate(
  (k) => window.__uclife__.receiveShipDelivery(k, 99), vb.buildingKey,
)
assert.ok(oob.ok === false && oob.reason === 'no_row',
  `OOB receive should be no_row; got ${JSON.stringify(oob)}`)

await page.evaluate(
  (arg) => window.__uclife__.enqueueShipDelivery(arg.k, 'lunarMilitia', arg.orderDay, arg.lead),
  { k: vb.buildingKey, orderDay: ORDER_DAY_SAVE_RT, lead: SMALL_HULL_LEAD_DAYS },
)
const preSave = await page.evaluate(() => window.__uclife__.deliverySnapshot())
await page.evaluate(async () => { await window.__uclife__.saveGame('auto') })
await page.evaluate(async () => { await window.__uclife__.loadGame('auto') })
await page.waitForFunction(
  () => typeof window.__uclife__?.deliverySnapshot === 'function',
  null, { timeout: SAVE_LOAD_READY_TIMEOUT_MS },
)
const postLoad = await page.evaluate(() => window.__uclife__.deliverySnapshot())
assert.equal(postLoad.length, preSave.length,
  `save round-trip lost rows: ${preSave.length} → ${postLoad.length}`)
assert.equal(postLoad[0]?.shipClassId, preSave[0]?.shipClassId,
  `save round-trip shipClassId mismatch`)
assert.equal(postLoad[0]?.orderDay, preSave[0]?.orderDay,
  `save round-trip orderDay mismatch`)
assert.equal(postLoad[0]?.arrivalDay, preSave[0]?.arrivalDay,
  `save round-trip arrivalDay mismatch`)
assert.equal(postLoad[0]?.status, preSave[0]?.status,
  `save round-trip status mismatch`)

const cap = vb.slotCapacity.smallCraft ?? 0
const occupiedAfterReceive = (await page.evaluate(
  (k) => window.__uclife__.hangarOccupancy(k), vb.buildingKey,
)).occupied.smallCraft ?? 0
const needToFillSlots = cap - occupiedAfterReceive
for (let i = 0; i < needToFillSlots; i++) {
  await page.evaluate((arg) => window.__uclife__.enqueueShipDelivery(
    arg.k, 'lunarMilitia', arg.orderDay, 0,
  ), { k: vb.buildingKey, orderDay: NO_SLOT_ENQUEUE_DAY })
}
await page.evaluate((d) => window.__uclife__.runShipDeliveryTick(d), NO_SLOT_TICK_DAY)
let receiveOK = 0
let safety = 0
const safetyLimit = cap + 4
while (receiveOK < needToFillSlots && safety < safetyLimit) {
  safety += 1
  const r = await page.evaluate(
    (k) => window.__uclife__.receiveShipDelivery(k, 0), vb.buildingKey,
  )
  if (r.ok) receiveOK += 1
  else if (r.reason !== 'no_row') break
}
assert.equal(receiveOK, needToFillSlots,
  `expected to receive ${needToFillSlots} extra ships, only received ${receiveOK}`)

await page.evaluate((arg) => window.__uclife__.enqueueShipDelivery(
  arg.k, 'lunarMilitia', arg.orderDay, 0,
), { k: vb.buildingKey, orderDay: ORDER_DAY_FOR_NO_SLOT_PROBE })
await page.evaluate((d) => window.__uclife__.runShipDeliveryTick(d), NO_SLOT_FINAL_DAY)
const slotBlocked = await page.evaluate(
  (k) => window.__uclife__.receiveShipDelivery(k, 0), vb.buildingKey,
)
assert.ok(slotBlocked.ok === false && slotBlocked.reason === 'no_slot',
  `expected receive to refuse with no_slot at capacity, got: ${JSON.stringify(slotBlocked)}`)

assert.equal(errors.length, 0,
  `page error(s) during test:\n${errors.map((e) => '  ' + e).join('\n')}`)

console.log('OK — check-light-hull-buy:')
console.log(`  VB hangar: ${vb.buildingKey} cap=${JSON.stringify(vb.slotCapacity)}`)
console.log(`  enqueue → arrive @ day ${ARRIVAL_DAY_INITIAL} → receive: ${rx.entityKey}`)
console.log(`  slot ${SLOT_KEY}: ${occBefore} → ${occAfter}`)
console.log(`  no-slot gate fires after ${needToFillSlots + 1} extra fills`)

await browser.close()
