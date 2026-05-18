import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import { BOOT_READY_TIMEOUT_MS, SAVE_LOAD_READY_TIMEOUT_MS, VIEWPORT } from './_test-constants.mjs'

// Phase 6.2.C2 Pegasus buy + fleet roster smoke — migrated to the
// deterministic API (Phase 6, Category A). The sim clock is frozen by
// ?test=1; runShipDeliveryTick(day) is the only time-advancing verb,
// always called with explicit target days.
//
// Coverage:
//  1. Granada AE sales rep (ae_ship_sales_granada) seated at world-init.
//  2. shipSalesRepEntity locates that rep.
//  3. enqueueShipDelivery accepts pegasusClass + drydock building, writes
//     an in-transit row with the configured 5-day capital lead time.
//  4. enqueueShipDelivery rejects unknown buildingKey.
//  5. runShipDeliveryTick(arrivalDay) flips the pegasus row to 'arrived'.
//  6. receiveShipDelivery spawns a pegasusClass Ship at granada with full
//     hull, increments capital slot, pops the queue row.
//  7. fleetRosterSnapshot lists exactly TWO ships with expected fields.
//  8. setFleetRosterOpen toggles the modal open/close.
//  9. Save round-trip preserves both the pending row and the spawned ship.
// 10. No-slot path fires once capital slots are filled.

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1', baseUrl).toString()

const PEGASUS_LEAD_DAYS = 5
const ORDER_DAY_INITIAL = 1
const ARRIVAL_DAY_INITIAL = ORDER_DAY_INITIAL + PEGASUS_LEAD_DAYS
const ORDER_DAY_SAVE_RT = 20
const NO_SLOT_FILL_ORDER_DAY = 1100
const NO_SLOT_FILL_TICK_DAY = 1200
const NO_SLOT_PROBE_ORDER_DAY = 2000
const NO_SLOT_PROBE_TICK_DAY = 2100
const HIGH_FLUSH_TICK_DAY = 1000
const EXPECTED_FLEET_AFTER_BUY = 2

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: VIEWPORT })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })

await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.listHangarsAllScenes === 'function'
    && typeof window.__uclife__?.fillJobVacancies === 'function'
    && typeof window.__uclife__?.deliverySnapshot === 'function'
    && typeof window.__uclife__?.enqueueShipDelivery === 'function'
    && typeof window.__uclife__?.runShipDeliveryTick === 'function'
    && typeof window.__uclife__?.receiveShipDelivery === 'function'
    && typeof window.__uclife__?.hangarOccupancy === 'function'
    && typeof window.__uclife__?.listShipsInFleet === 'function'
    && typeof window.__uclife__?.shipSalesRepEntity === 'function'
    && typeof window.__uclife__?.fleetRosterSnapshot === 'function'
    && typeof window.__uclife__?.setFleetRosterOpen === 'function'
    && typeof window.__uclife__?.forceShipDocking === 'function'
    && typeof window.__uclife__?.saveGame === 'function'
    && typeof window.__uclife__?.loadGame === 'function',
  null,
  { timeout: BOOT_READY_TIMEOUT_MS },
)

await page.evaluate(() => window.__uclife__.fillJobVacancies(['hangar_manager']))
await page.evaluate(() => window.__uclife__.fillJobVacancies(['hangar_manager']))

const granadaRep = await page.evaluate(() =>
  window.__uclife__.shipSalesRepEntity('ae_ship_sales_granada'),
)
assert.ok(granadaRep, 'ae_ship_sales_granada rep missing — special-NPC bootstrap regression')

const hangars = await page.evaluate(() => window.__uclife__.listHangarsAllScenes())
const drydock = hangars.find((h) => h.typeId === 'hangarDrydock')
const vbHangar = hangars.find((h) => h.typeId === 'hangarSurface')
assert.ok(drydock, 'Granada drydock building missing')
assert.ok(vbHangar, 'VB state hangar building missing')

const bad = await page.evaluate(
  ([orderDay, lead]) => window.__uclife__.enqueueShipDelivery(
    'bld-nonexistent-x-0', 'pegasusClass', orderDay, lead,
  ),
  [ORDER_DAY_INITIAL, PEGASUS_LEAD_DAYS],
)
assert.equal(bad, null,
  `enqueueShipDelivery accepted bogus buildingKey: ${JSON.stringify(bad)}`)

const enq = await page.evaluate((arg) => window.__uclife__.enqueueShipDelivery(
  arg.k, 'pegasusClass', arg.orderDay, arg.lead,
), { k: drydock.buildingKey, orderDay: ORDER_DAY_INITIAL, lead: PEGASUS_LEAD_DAYS })
assert.ok(enq && enq.rowIndex === 0,
  `enqueueShipDelivery rowIndex unexpected: ${JSON.stringify(enq)}`)

const snap1 = await page.evaluate(() => window.__uclife__.deliverySnapshot())
const row1 = snap1.find(
  (r) => r.shipClassId === 'pegasusClass' && r.hangarKey === drydock.buildingKey,
)
assert.ok(row1, `no pegasus row in snapshot for drydock: ${JSON.stringify(snap1)}`)
assert.equal(row1.status, 'in_transit', `row.status=${row1.status} (want 'in_transit')`)
assert.equal(row1.arrivalDay, ARRIVAL_DAY_INITIAL,
  `row.arrivalDay=${row1.arrivalDay} (want ${ARRIVAL_DAY_INITIAL})`)

const earlyRx = await page.evaluate(
  (k) => window.__uclife__.receiveShipDelivery(k, 0), drydock.buildingKey,
)
assert.ok(earlyRx.ok === false && earlyRx.reason === 'not_arrived',
  `receive before arrival should refuse with not_arrived; got ${JSON.stringify(earlyRx)}`)

const tickRes = await page.evaluate(
  (d) => window.__uclife__.runShipDeliveryTick(d), ARRIVAL_DAY_INITIAL,
)
assert.ok(tickRes && tickRes.rowsArrived === 1,
  `runShipDeliveryTick(${ARRIVAL_DAY_INITIAL}) result unexpected: ${JSON.stringify(tickRes)}`)

const snap2 = await page.evaluate(() => window.__uclife__.deliverySnapshot())
const row2 = snap2.find(
  (r) => r.shipClassId === 'pegasusClass' && r.hangarKey === drydock.buildingKey,
)
assert.equal(row2?.status, 'arrived',
  `row.status after tick = ${row2?.status} (want 'arrived')`)

const occBefore = await page.evaluate(
  (k) => window.__uclife__.hangarOccupancy(k), drydock.buildingKey,
)
const fleetBefore = await page.evaluate(() => window.__uclife__.listShipsInFleet())
const rx = await page.evaluate(
  (k) => window.__uclife__.receiveShipDelivery(k, 0), drydock.buildingKey,
)
assert.ok(rx.ok, `receive returned not-ok: ${JSON.stringify(rx)}`)

const occAfter = await page.evaluate(
  (k) => window.__uclife__.hangarOccupancy(k), drydock.buildingKey,
)
const fleetAfter = await page.evaluate(() => window.__uclife__.listShipsInFleet())
const capBefore = occBefore.occupied.capital ?? 0
const capAfter = occAfter.occupied.capital ?? 0
assert.equal(capAfter, capBefore + 1,
  `capital slot occupancy: ${capBefore} → ${capAfter} (want +1)`)

const newShip = fleetAfter.find((s) => !fleetBefore.some((b) => b.entityKey === s.entityKey))
assert.ok(newShip, 'could not isolate newly-spawned Pegasus in fleet snapshot')
assert.equal(newShip.templateId, 'pegasusClass',
  `new ship templateId=${newShip.templateId}`)
assert.equal(newShip.dockedAtPoiId, 'granada',
  `new ship dockedAtPoiId=${newShip.dockedAtPoiId} (want granada)`)
assert.ok(!newShip.isFlagship,
  'new pegasus spawned with IsFlagshipMark — should be non-flagship')
assert.equal(newShip.hullCurrent, newShip.hullMax,
  `new ship hull not full: ${newShip.hullCurrent}/${newShip.hullMax}`)

const snap3 = await page.evaluate(() => window.__uclife__.deliverySnapshot())
assert.ok(!snap3.find(
  (r) => r.shipClassId === 'pegasusClass' && r.hangarKey === drydock.buildingKey,
), 'pegasus row not popped from queue after receive')

const roster = await page.evaluate(() => window.__uclife__.fleetRosterSnapshot())
assert.equal(roster.length, EXPECTED_FLEET_AFTER_BUY,
  `fleet roster length=${roster.length} (want ${EXPECTED_FLEET_AFTER_BUY}). roster=${JSON.stringify(roster)}`)

const flagshipRow = roster.find((r) => r.isFlagship)
const pegasusRow = roster.find((r) => r.templateId === 'pegasusClass')
assert.ok(flagshipRow, 'roster missing flagship entry')
assert.equal(flagshipRow.templateId, 'lightFreighter',
  `flagship templateId=${flagshipRow.templateId} (want lightFreighter)`)
assert.equal(flagshipRow.poiId, 'vonBraun',
  `flagship poiId=${flagshipRow.poiId} (want vonBraun)`)
assert.ok(flagshipRow.shipName, 'flagship row missing shipName')
assert.ok(pegasusRow, 'roster missing pegasus entry')
assert.equal(pegasusRow.poiId, 'granada',
  `pegasus poiId=${pegasusRow.poiId} (want granada)`)
assert.equal(pegasusRow.hangarSlotClass, 'capital',
  `pegasus hangarSlotClass=${pegasusRow.hangarSlotClass}`)
assert.ok(!pegasusRow.isFlagship, 'pegasus marked flagship in roster')

const opened = await page.evaluate(() => window.__uclife__.setFleetRosterOpen(true))
assert.equal(opened, true, `setFleetRosterOpen(true) returned ${opened}`)
await page.evaluate(() => window.__uclife__.setFleetRosterOpen(false))

await page.evaluate(
  (arg) => window.__uclife__.enqueueShipDelivery(arg.k, 'pegasusClass', arg.orderDay, arg.lead),
  { k: drydock.buildingKey, orderDay: ORDER_DAY_SAVE_RT, lead: PEGASUS_LEAD_DAYS },
)
const preSaveSnap = await page.evaluate(() => window.__uclife__.deliverySnapshot())
const preSaveFleet = await page.evaluate(() => window.__uclife__.listShipsInFleet())
await page.evaluate(async () => { await window.__uclife__.saveGame('auto') })
await page.evaluate(async () => { await window.__uclife__.loadGame('auto') })
await page.waitForFunction(
  () => typeof window.__uclife__?.deliverySnapshot === 'function',
  null, { timeout: SAVE_LOAD_READY_TIMEOUT_MS },
)
const postLoadSnap = await page.evaluate(() => window.__uclife__.deliverySnapshot())
const postLoadFleet = await page.evaluate(() => window.__uclife__.listShipsInFleet())
assert.equal(postLoadSnap.length, preSaveSnap.length,
  `save round-trip lost rows: ${preSaveSnap.length} → ${postLoadSnap.length}`)
assert.equal(postLoadFleet.length, preSaveFleet.length,
  `save round-trip fleet count: ${preSaveFleet.length} → ${postLoadFleet.length}`)
const postPegasus = postLoadFleet.find((s) => s.templateId === 'pegasusClass')
assert.ok(postPegasus, 'save round-trip lost the spawned Pegasus ship entity')
assert.equal(postPegasus.dockedAtPoiId, 'granada',
  `save round-trip pegasus dockedAtPoiId=${postPegasus.dockedAtPoiId}`)

const capCap = drydock.slotCapacity.capital ?? 0
let curCap = (await page.evaluate(
  (k) => window.__uclife__.hangarOccupancy(k), drydock.buildingKey,
)).occupied.capital ?? 0

await page.evaluate((d) => window.__uclife__.runShipDeliveryTick(d), HIGH_FLUSH_TICK_DAY)
while (curCap < capCap) {
  const snap = await page.evaluate(() => window.__uclife__.deliverySnapshot())
  const idx = snap.findIndex((r) => r.hangarKey === drydock.buildingKey
    && r.shipClassId === 'pegasusClass' && r.status === 'arrived')
  if (idx < 0) {
    await page.evaluate(
      (arg) => window.__uclife__.enqueueShipDelivery(arg.k, 'pegasusClass', arg.orderDay, 0),
      { k: drydock.buildingKey, orderDay: NO_SLOT_FILL_ORDER_DAY },
    )
    await page.evaluate((d) => window.__uclife__.runShipDeliveryTick(d), NO_SLOT_FILL_TICK_DAY)
    continue
  }
  const r = await page.evaluate(
    (arg) => window.__uclife__.receiveShipDelivery(arg.k, arg.idx),
    { k: drydock.buildingKey, idx },
  )
  if (!r.ok) break
  curCap += 1
}
assert.equal(curCap, capCap,
  `could not fill all ${capCap} capital slots — only filled to ${curCap}`)

await page.evaluate(
  (arg) => window.__uclife__.enqueueShipDelivery(arg.k, 'pegasusClass', arg.orderDay, 0),
  { k: drydock.buildingKey, orderDay: NO_SLOT_PROBE_ORDER_DAY },
)
await page.evaluate((d) => window.__uclife__.runShipDeliveryTick(d), NO_SLOT_PROBE_TICK_DAY)
const blockSnap = await page.evaluate(() => window.__uclife__.deliverySnapshot())
const blockIdx = blockSnap.findIndex((r) => r.hangarKey === drydock.buildingKey
  && r.shipClassId === 'pegasusClass' && r.status === 'arrived')
assert.ok(blockIdx >= 0,
  `expected at least one arrived row to test no_slot gate; queue: ${JSON.stringify(blockSnap)}`)
const blocked = await page.evaluate(
  (arg) => window.__uclife__.receiveShipDelivery(arg.k, arg.idx),
  { k: drydock.buildingKey, idx: blockIdx },
)
assert.ok(blocked.ok === false && blocked.reason === 'no_slot',
  `expected no_slot at capacity ${curCap}/${capCap}, got: ${JSON.stringify(blocked)}`)

assert.equal(errors.length, 0,
  `page error(s) during test:\n${errors.map((e) => '  ' + e).join('\n')}`)

console.log('OK — check-pegasus-buy:')
console.log(`  drydock: ${drydock.buildingKey} cap=${JSON.stringify(drydock.slotCapacity)}`)
console.log(`  pegasus delivered → ${rx.entityKey} @ granada`)
console.log(`  fleet roster: ${roster.length} ships`)
console.log(`  no-slot gate fires after ${curCap}/${capCap} capital slots filled`)

await browser.close()
