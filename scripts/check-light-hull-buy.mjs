// Phase 6.2.C1 light-hull buy smoke. Verifies:
//  1. The AE Von Braun ship-sales rep is seated at the airport sales desk
//     after fillJobVacancies, with the ae_ship_sales_vb spec.
//  2. enqueueShipDelivery refuses gracefully when the target hangar is
//     unknown (returns null).
//  3. enqueueShipDelivery records a pending row with the configured
//     2-day lead time, in_transit by default.
//  4. runShipDeliveryTick(arrivalDay) flips status to 'arrived'.
//  5. receiveShipDelivery spawns a new Ship entity in the fleet, sets
//     dockedAtPoiId to the hangar's POI, increments slot occupancy, and
//     pops the row from the queue.
//  6. receiveShipDelivery returns reason='not_arrived' for an in-transit
//     row, and reason='no_row' for an out-of-bounds index.
//  7. Save round-trip preserves a pending delivery row exactly.
//  8. The "no slot — rent at Von Braun state hangar" branch fires by
//     filling capacity then attempting another buy: receiveShipDelivery
//     refuses with reason='no_slot'.

import { chromium } from 'playwright'

const url = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof globalThis.__uclife__?.listHangars === 'function'
    && typeof globalThis.__uclife__?.fillJobVacancies === 'function'
    && typeof globalThis.__uclife__?.deliverySnapshot === 'function'
    && typeof globalThis.__uclife__?.enqueueShipDelivery === 'function'
    && typeof globalThis.__uclife__?.runShipDeliveryTick === 'function'
    && typeof globalThis.__uclife__?.receiveShipDelivery === 'function'
    && typeof globalThis.__uclife__?.hangarOccupancy === 'function'
    && typeof globalThis.__uclife__?.listShipsInFleet === 'function'
    && typeof globalThis.__uclife__?.saveGame === 'function'
    && typeof globalThis.__uclife__?.loadGame === 'function',
  null,
  { timeout: 30_000 },
)

await page.evaluate(() => globalThis.__uclife__.useClock.getState().setSpeed(0))

const failures = []
const fail = (m) => failures.push(m)
const pass = (m) => console.log('PASS ' + m)

// 0. fillJobVacancies for the sales rep + hangar staff.
await page.evaluate(() => globalThis.__uclife__.fillJobVacancies(
  ['ae_ship_sales_vb', 'hangar_manager', 'hangar_worker']
))

// 1. AE sales rep seated.
const salesSeated = await page.evaluate(() => {
  const out = []
  for (const e of globalThis.__uclife__.world.query()) void e
  return globalThis.__uclife__.fillJobVacancies(['ae_ship_sales_vb'])
})
if (!Array.isArray(salesSeated)) fail('fillJobVacancies(ae_ship_sales_vb) returned non-array')
else if (!salesSeated[0]?.ok) fail(`ae_ship_sales_vb fill failed: ${JSON.stringify(salesSeated)}`)
else pass(`ae_ship_sales_vb seated`)

// Locate the VB state hangar.
const hangars = await page.evaluate(() => globalThis.__uclife__.listHangars())
const vb = hangars.find((h) => h.typeId === 'hangarSurface')
if (!vb) { fail('VB state hangar missing — 6.2.A regression'); await done() }
pass(`VB hangar: ${vb.buildingKey} cap=${JSON.stringify(vb.slotCapacity)}`)

// 2. Reject on unknown buildingKey.
const bad = await page.evaluate(() => globalThis.__uclife__.enqueueShipDelivery(
  'bld-nonexistent-x-0', 'lunarMilitia', 1, 2
))
if (bad !== null) fail(`enqueueShipDelivery accepted bogus buildingKey: ${JSON.stringify(bad)}`)
else pass('enqueueShipDelivery rejects unknown buildingKey')

// 3. Enqueue a real row (orderDay=1, leadTime=2, arrivalDay=3).
const enq = await page.evaluate((arg) => globalThis.__uclife__.enqueueShipDelivery(
  arg.k, 'lunarMilitia', 1, 2
), { k: vb.buildingKey })
if (!enq || enq.rowIndex !== 0) fail(`enqueueShipDelivery rowIndex unexpected: ${JSON.stringify(enq)}`)
else pass(`enqueued row index ${enq.rowIndex}`)

const snap1 = await page.evaluate(() => globalThis.__uclife__.deliverySnapshot())
if (snap1.length !== 1) fail(`deliverySnapshot length=${snap1.length} (want 1)`)
const row = snap1[0]
if (row.status !== 'in_transit') fail(`row.status=${row.status} (want 'in_transit')`)
if (row.shipClassId !== 'lunarMilitia') fail(`row.shipClassId=${row.shipClassId}`)
if (row.orderDay !== 1) fail(`row.orderDay=${row.orderDay} (want 1)`)
if (row.arrivalDay !== 3) fail(`row.arrivalDay=${row.arrivalDay} (want 3 = 1 + 2)`)
else pass(`row in_transit with arrivalDay=${row.arrivalDay}`)

// 4. Receive before arrival should fail.
const earlyRx = await page.evaluate((k) => globalThis.__uclife__.receiveShipDelivery(k, 0), vb.buildingKey)
if (earlyRx.ok !== false || earlyRx.reason !== 'not_arrived') {
  fail(`receive before arrival should refuse with not_arrived; got ${JSON.stringify(earlyRx)}`)
} else pass('receive before arrival → refused with not_arrived')

// runShipDeliveryTick at the row's arrivalDay flips status.
const tickRes = await page.evaluate(() => globalThis.__uclife__.runShipDeliveryTick(3))
if (!tickRes || tickRes.rowsArrived !== 1) {
  fail(`runShipDeliveryTick(3) result unexpected: ${JSON.stringify(tickRes)}`)
} else pass(`runShipDeliveryTick(3) advanced 1 row to arrived`)

const snap2 = await page.evaluate(() => globalThis.__uclife__.deliverySnapshot())
if (snap2[0]?.status !== 'arrived') fail(`row.status after tick = ${snap2[0]?.status} (want 'arrived')`)
else pass('row flipped to arrived')

// 5. Receive lands a new Ship in the fleet.
const occupancyBefore = await page.evaluate((k) => globalThis.__uclife__.hangarOccupancy(k), vb.buildingKey)
const fleetBefore = await page.evaluate(() => globalThis.__uclife__.listShipsInFleet())
const rx = await page.evaluate((k) => globalThis.__uclife__.receiveShipDelivery(k, 0), vb.buildingKey)
if (!rx.ok) fail(`receive returned not-ok: ${JSON.stringify(rx)}`)
else pass(`received: ${rx.entityKey}`)

const occupancyAfter = await page.evaluate((k) => globalThis.__uclife__.hangarOccupancy(k), vb.buildingKey)
const fleetAfter = await page.evaluate(() => globalThis.__uclife__.listShipsInFleet())

const slotKey = 'smallCraft'
const occBefore = occupancyBefore.occupied[slotKey] ?? 0
const occAfter = occupancyAfter.occupied[slotKey] ?? 0
if (occAfter !== occBefore + 1) {
  fail(`slot occupancy delta ${slotKey}: ${occBefore} → ${occAfter} (want +1)`)
} else pass(`slot occupancy ${slotKey}: ${occBefore} → ${occAfter}`)

if (fleetAfter.length !== fleetBefore.length + 1) {
  fail(`fleet count delta: ${fleetBefore.length} → ${fleetAfter.length} (want +1)`)
}
const newShip = fleetAfter.find((s) => !fleetBefore.some((b) => b.entityKey === s.entityKey))
if (!newShip) fail('could not isolate newly-spawned ship in fleet snapshot')
else {
  if (newShip.templateId !== 'lunarMilitia') fail(`new ship templateId=${newShip.templateId}`)
  if (newShip.dockedAtPoiId !== 'vonBraun') fail(`new ship dockedAtPoiId=${newShip.dockedAtPoiId} (want vonBraun)`)
  if (newShip.isFlagship) fail('newly-delivered ship spawned with IsFlagshipMark — should be non-flagship')
  if (newShip.hullCurrent !== newShip.hullMax) fail(`new ship hull not full: ${newShip.hullCurrent}/${newShip.hullMax}`)
  pass(`new ship: ${newShip.entityKey} templateId=${newShip.templateId} dockedAt=${newShip.dockedAtPoiId} hull=${newShip.hullCurrent}/${newShip.hullMax}`)
}

const snap3 = await page.evaluate(() => globalThis.__uclife__.deliverySnapshot())
if (snap3.length !== 0) fail(`pending after receive: ${snap3.length} rows (want 0)`)
else pass('row removed from queue after receive')

// 6. Receive out-of-bounds index.
const oob = await page.evaluate((k) => globalThis.__uclife__.receiveShipDelivery(k, 99), vb.buildingKey)
if (oob.ok !== false || oob.reason !== 'no_row') fail(`OOB receive should be no_row; got ${JSON.stringify(oob)}`)
else pass('OOB receive → no_row')

// 7. Save round-trip.
await page.evaluate((k) => globalThis.__uclife__.enqueueShipDelivery(k, 'lunarMilitia', 5, 2), vb.buildingKey)
const preSave = await page.evaluate(() => globalThis.__uclife__.deliverySnapshot())
await page.evaluate(async () => { await globalThis.__uclife__.saveGame('auto') })
await page.evaluate(async () => { await globalThis.__uclife__.loadGame('auto') })
const postLoad = await page.evaluate(() => globalThis.__uclife__.deliverySnapshot())
if (postLoad.length !== preSave.length) {
  fail(`save round-trip lost rows: ${preSave.length} → ${postLoad.length}`)
} else if (postLoad[0]?.shipClassId !== preSave[0]?.shipClassId
        || postLoad[0]?.orderDay !== preSave[0]?.orderDay
        || postLoad[0]?.arrivalDay !== preSave[0]?.arrivalDay
        || postLoad[0]?.status !== preSave[0]?.status) {
  fail(`save round-trip row mismatch: ${JSON.stringify(preSave[0])} vs ${JSON.stringify(postLoad[0])}`)
} else pass(`save round-trip preserved pending row ${JSON.stringify(postLoad[0])}`)

// 8. No-slot path: fill the remaining smallCraft slots and try to receive.
//    The pre-existing flagship already sits in vonBraun with hangarSlotClass=smallCraft.
//    After receiving the lunarMilitia above, we have 2 smallCraft occupants.
//    Enqueue + force arrival of (capacity - 2) more rows; receive them; then
//    one more should refuse with no_slot at receive time. We tick at a high
//    gameDay so every pending row (including the save-round-trip row whose
//    arrivalDay=7) is flagged 'arrived'.
const cap = vb.slotCapacity.smallCraft ?? 0
const occupiedAfterReceive = (await page.evaluate(
  (k) => globalThis.__uclife__.hangarOccupancy(k), vb.buildingKey,
)).occupied.smallCraft ?? 0
const needToFillSlots = cap - occupiedAfterReceive
for (let i = 0; i < needToFillSlots; i++) {
  await page.evaluate((arg) => globalThis.__uclife__.enqueueShipDelivery(arg.k, 'lunarMilitia', 50, 0), { k: vb.buildingKey })
}
// Tick far enough in the future to flip every pending row.
await page.evaluate(() => globalThis.__uclife__.runShipDeliveryTick(100))
let receiveOK = 0
let safety = 0
while (receiveOK < needToFillSlots && safety < cap + 4) {
  safety += 1
  const r = await page.evaluate((k) => globalThis.__uclife__.receiveShipDelivery(k, 0), vb.buildingKey)
  if (r.ok) receiveOK += 1
  else if (r.reason !== 'no_row') break
}
if (receiveOK !== needToFillSlots) {
  fail(`expected to receive ${needToFillSlots} extra ships, only received ${receiveOK}`)
} else pass(`filled smallCraft slots: received ${needToFillSlots} more ships`)

// One more arrived row to attempt — should refuse with no_slot.
await page.evaluate((arg) => globalThis.__uclife__.enqueueShipDelivery(arg.k, 'lunarMilitia', 100, 0), { k: vb.buildingKey })
await page.evaluate(() => globalThis.__uclife__.runShipDeliveryTick(101))
const slotBlocked = await page.evaluate((k) => globalThis.__uclife__.receiveShipDelivery(k, 0), vb.buildingKey)
if (slotBlocked.ok !== false || slotBlocked.reason !== 'no_slot') {
  fail(`expected receive to refuse with no_slot at capacity, got: ${JSON.stringify(slotBlocked)}`)
} else pass('receive at capacity → no_slot gate fires correctly')

await done()

async function done() {
  await browser.close()
  if (errors.length) {
    console.log('\nERRORS:')
    errors.forEach((e) => console.log('  ' + e))
  }
  if (failures.length) {
    console.log('\nFAILURES:')
    failures.forEach((f) => console.log('  ' + f))
    process.exit(1)
  }
  console.log('\nOK: AE VB ship sales → delivery queue → hangar receive verified.')
}
