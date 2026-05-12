// Phase 6.2.C2 Pegasus buy + fleet roster smoke. Verifies:
//
//  1. Granada AE sales rep (ae_ship_sales_granada) seated at world-init.
//  2. shipSalesRepEntity locates that rep.
//  3. enqueueShipDelivery accepts pegasusClass + drydock building, writes
//     an in-transit row with the configured 5-day capital lead time.
//  4. enqueueShipDelivery rejects unknown buildingKey (returns null).
//  5. runShipDeliveryTick(arrivalDay) flips the pegasus row to 'arrived'.
//  6. receiveShipDelivery spawns a pegasusClass Ship in playerShipInterior
//     with dockedAtPoiId='granada', increments capital slot 0 → 1,
//     pops the queue row.
//  7. fleetRosterSnapshot lists exactly TWO ships with expected fields:
//     flagship lightFreighter at vonBraun + new pegasus at granada.
//  8. setFleetRosterOpen toggles the modal open/close.
//  9. Save round-trip preserves both the pending row and the spawned ship.
// 10. No-slot path: fake-occupy capital slots via forceShipDocking, then
//     enqueue + tick + receive — refuses with reason='no_slot'.

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
  () => typeof globalThis.__uclife__?.listHangarsAllScenes === 'function'
    && typeof globalThis.__uclife__?.fillJobVacancies === 'function'
    && typeof globalThis.__uclife__?.deliverySnapshot === 'function'
    && typeof globalThis.__uclife__?.enqueueShipDelivery === 'function'
    && typeof globalThis.__uclife__?.runShipDeliveryTick === 'function'
    && typeof globalThis.__uclife__?.receiveShipDelivery === 'function'
    && typeof globalThis.__uclife__?.hangarOccupancy === 'function'
    && typeof globalThis.__uclife__?.listShipsInFleet === 'function'
    && typeof globalThis.__uclife__?.shipSalesRepEntity === 'function'
    && typeof globalThis.__uclife__?.fleetRosterSnapshot === 'function'
    && typeof globalThis.__uclife__?.setFleetRosterOpen === 'function'
    && typeof globalThis.__uclife__?.forceShipDocking === 'function'
    && typeof globalThis.__uclife__?.saveGame === 'function'
    && typeof globalThis.__uclife__?.loadGame === 'function',
  null,
  { timeout: 30_000 },
)

await page.evaluate(() => globalThis.__uclife__.useClock.getState().setSpeed(0))

const failures = []
const fail = (m) => failures.push(m)
const pass = (m) => console.log('PASS ' + m)

// 0. Seat hangar managers across both VB and Granada drydock. The smoke
//    runs without riding the orbital lift (active scene stays vonBraunCity),
//    so we call fillJobVacancies repeatedly: the active-scene preference
//    seats the VB manager first, then the second call falls back to the
//    drydock manager (the only remaining unmanned hangar_manager seat).
//    Granada AE sales rep auto-seats via the special-NPC bootstrap.
await page.evaluate(() => globalThis.__uclife__.fillJobVacancies(['hangar_manager']))
await page.evaluate(() => globalThis.__uclife__.fillJobVacancies(['hangar_manager']))

// 1. Granada AE rep present + seated.
const granadaRep = await page.evaluate(() =>
  globalThis.__uclife__.shipSalesRepEntity('ae_ship_sales_granada'),
)
if (!granadaRep) fail('ae_ship_sales_granada rep missing — special-NPC bootstrap regression')
else pass('granada AE rep seated')

// Locate hangars (multi-scene — drydock is in granadaDrydock, not the
// active scene at smoke start).
const hangars = await page.evaluate(() => globalThis.__uclife__.listHangarsAllScenes())
const drydock = hangars.find((h) => h.typeId === 'hangarDrydock')
const vbHangar = hangars.find((h) => h.typeId === 'hangarSurface')
if (!drydock) { fail('Granada drydock building missing'); await done() }
if (!vbHangar) { fail('VB state hangar building missing'); await done() }
pass(`drydock: ${drydock.buildingKey} cap=${JSON.stringify(drydock.slotCapacity)}`)

// 2. Reject unknown buildingKey.
const bad = await page.evaluate(() => globalThis.__uclife__.enqueueShipDelivery(
  'bld-nonexistent-x-0', 'pegasusClass', 1, 5,
))
if (bad !== null) fail(`enqueueShipDelivery accepted bogus buildingKey: ${JSON.stringify(bad)}`)
else pass('enqueueShipDelivery rejects unknown buildingKey')

// 3. Enqueue Pegasus (orderDay=1, leadTime=5 → arrivalDay=6).
const enq = await page.evaluate((k) => globalThis.__uclife__.enqueueShipDelivery(
  k, 'pegasusClass', 1, 5,
), drydock.buildingKey)
if (!enq || enq.rowIndex !== 0) fail(`enqueueShipDelivery rowIndex unexpected: ${JSON.stringify(enq)}`)
else pass(`enqueued Pegasus row index ${enq.rowIndex}`)

const snap1 = await page.evaluate(() => globalThis.__uclife__.deliverySnapshot())
const row1 = snap1.find((r) => r.shipClassId === 'pegasusClass' && r.hangarKey === drydock.buildingKey)
if (!row1) fail(`no pegasus row in snapshot for drydock: ${JSON.stringify(snap1)}`)
else if (row1.status !== 'in_transit') fail(`row.status=${row1.status} (want 'in_transit')`)
else if (row1.arrivalDay !== 6) fail(`row.arrivalDay=${row1.arrivalDay} (want 6 = 1 + 5)`)
else pass(`pegasus row in_transit · arrivalDay=${row1.arrivalDay}`)

// 4. Receive before arrival → not_arrived.
const earlyRx = await page.evaluate((k) => globalThis.__uclife__.receiveShipDelivery(k, 0), drydock.buildingKey)
if (earlyRx.ok !== false || earlyRx.reason !== 'not_arrived') {
  fail(`receive before arrival should refuse with not_arrived; got ${JSON.stringify(earlyRx)}`)
} else pass('receive before arrival → not_arrived')

// 5. Tick at arrivalDay flips status.
const tickRes = await page.evaluate(() => globalThis.__uclife__.runShipDeliveryTick(6))
if (!tickRes || tickRes.rowsArrived !== 1) {
  fail(`runShipDeliveryTick(6) result unexpected: ${JSON.stringify(tickRes)}`)
} else pass(`runShipDeliveryTick(6) advanced 1 row to arrived`)

const snap2 = await page.evaluate(() => globalThis.__uclife__.deliverySnapshot())
const row2 = snap2.find((r) => r.shipClassId === 'pegasusClass' && r.hangarKey === drydock.buildingKey)
if (row2?.status !== 'arrived') fail(`row.status after tick = ${row2?.status} (want 'arrived')`)
else pass('pegasus row flipped to arrived')

// 6. Receive spawns the Pegasus.
const occBefore = await page.evaluate((k) => globalThis.__uclife__.hangarOccupancy(k), drydock.buildingKey)
const fleetBefore = await page.evaluate(() => globalThis.__uclife__.listShipsInFleet())
const rx = await page.evaluate((k) => globalThis.__uclife__.receiveShipDelivery(k, 0), drydock.buildingKey)
if (!rx.ok) fail(`receive returned not-ok: ${JSON.stringify(rx)}`)
else pass(`received: ${rx.entityKey}`)

const occAfter = await page.evaluate((k) => globalThis.__uclife__.hangarOccupancy(k), drydock.buildingKey)
const fleetAfter = await page.evaluate(() => globalThis.__uclife__.listShipsInFleet())
const capBefore = occBefore.occupied.capital ?? 0
const capAfter = occAfter.occupied.capital ?? 0
if (capAfter !== capBefore + 1) {
  fail(`capital slot occupancy: ${capBefore} → ${capAfter} (want +1)`)
} else pass(`capital slot occupancy: ${capBefore} → ${capAfter}`)

const newShip = fleetAfter.find((s) => !fleetBefore.some((b) => b.entityKey === s.entityKey))
if (!newShip) fail('could not isolate newly-spawned Pegasus in fleet snapshot')
else {
  if (newShip.templateId !== 'pegasusClass') fail(`new ship templateId=${newShip.templateId}`)
  if (newShip.dockedAtPoiId !== 'granada') fail(`new ship dockedAtPoiId=${newShip.dockedAtPoiId} (want granada)`)
  if (newShip.isFlagship) fail('new pegasus spawned with IsFlagshipMark — should be non-flagship')
  if (newShip.hullCurrent !== newShip.hullMax) fail(`new ship hull not full: ${newShip.hullCurrent}/${newShip.hullMax}`)
  pass(`new ship: ${newShip.entityKey} templateId=${newShip.templateId} hull=${newShip.hullCurrent}/${newShip.hullMax}`)
}

const snap3 = await page.evaluate(() => globalThis.__uclife__.deliverySnapshot())
if (snap3.find((r) => r.shipClassId === 'pegasusClass' && r.hangarKey === drydock.buildingKey)) {
  fail('pegasus row not popped from queue after receive')
} else pass('pegasus row popped after receive')

// 7. Fleet roster shows TWO ships.
const roster = await page.evaluate(() => globalThis.__uclife__.fleetRosterSnapshot())
if (roster.length !== 2) {
  fail(`fleet roster length=${roster.length} (want 2 — flagship + pegasus). roster=${JSON.stringify(roster)}`)
} else pass(`fleet roster lists ${roster.length} ships`)

const flagshipRow = roster.find((r) => r.isFlagship)
const pegasusRow = roster.find((r) => r.templateId === 'pegasusClass')
if (!flagshipRow) fail('roster missing flagship entry')
else {
  if (flagshipRow.templateId !== 'lightFreighter') fail(`flagship templateId=${flagshipRow.templateId} (want lightFreighter)`)
  if (flagshipRow.poiId !== 'vonBraun') fail(`flagship poiId=${flagshipRow.poiId} (want vonBraun)`)
  if (!flagshipRow.shipName) fail('flagship row missing shipName')
  pass(`flagship row: ${flagshipRow.shipName} @ ${flagshipRow.hangarLabel || flagshipRow.poiId}`)
}
if (!pegasusRow) fail('roster missing pegasus entry')
else {
  if (pegasusRow.poiId !== 'granada') fail(`pegasus poiId=${pegasusRow.poiId} (want granada)`)
  if (pegasusRow.hangarSlotClass !== 'capital') fail(`pegasus hangarSlotClass=${pegasusRow.hangarSlotClass}`)
  if (pegasusRow.isFlagship) fail('pegasus marked flagship in roster')
  pass(`pegasus row: ${pegasusRow.shipName} @ ${pegasusRow.hangarLabel || pegasusRow.poiId}`)
}

// 8. setFleetRosterOpen toggle.
const opened = await page.evaluate(() => globalThis.__uclife__.setFleetRosterOpen(true))
if (opened !== true) fail(`setFleetRosterOpen(true) returned ${opened}`)
else pass('fleet roster modal flips open')
await page.evaluate(() => globalThis.__uclife__.setFleetRosterOpen(false))

// 9. Save round-trip preserves a pending row + the spawned Pegasus.
await page.evaluate((k) => globalThis.__uclife__.enqueueShipDelivery(k, 'pegasusClass', 20, 5), drydock.buildingKey)
const preSaveSnap = await page.evaluate(() => globalThis.__uclife__.deliverySnapshot())
const preSaveFleet = await page.evaluate(() => globalThis.__uclife__.listShipsInFleet())
await page.evaluate(async () => { await globalThis.__uclife__.saveGame('auto') })
await page.evaluate(async () => { await globalThis.__uclife__.loadGame('auto') })
const postLoadSnap = await page.evaluate(() => globalThis.__uclife__.deliverySnapshot())
const postLoadFleet = await page.evaluate(() => globalThis.__uclife__.listShipsInFleet())
if (postLoadSnap.length !== preSaveSnap.length) {
  fail(`save round-trip lost rows: ${preSaveSnap.length} → ${postLoadSnap.length}`)
} else pass(`save round-trip preserved ${postLoadSnap.length} pending row(s)`)
if (postLoadFleet.length !== preSaveFleet.length) {
  fail(`save round-trip fleet count: ${preSaveFleet.length} → ${postLoadFleet.length}`)
}
const postPegasus = postLoadFleet.find((s) => s.templateId === 'pegasusClass')
if (!postPegasus) fail('save round-trip lost the spawned Pegasus ship entity')
else if (postPegasus.dockedAtPoiId !== 'granada') {
  fail(`save round-trip pegasus dockedAtPoiId=${postPegasus.dockedAtPoiId}`)
} else pass('save round-trip preserved the spawned Pegasus')

// 10. No-slot path. Fake-occupy the drydock's capital slots via
//     forceShipDocking so the gate fires deterministically. Re-point
//     the existing flagship lightFreighter to granada (its hangarSlotClass
//     is smallCraft, so it doesn't count against capital). We need to
//     write a hull whose class is capital. We already have one Pegasus
//     occupying capital. Spawn (capCap - 1) more by enqueue+tick+receive
//     would re-walk the queue path; faster is to clone the existing
//     Pegasus's docking via forceShipDocking on synthetic hulls. But we
//     have no easy way to add hulls without enqueue. Use the enqueue
//     path with leadTime=0 so the tick at gameDay >= orderDay arrives
//     immediately.
const capCap = drydock.slotCapacity.capital ?? 0
let curCap = (await page.evaluate(
  (k) => globalThis.__uclife__.hangarOccupancy(k), drydock.buildingKey,
)).occupied.capital ?? 0

// First receive any rows still arrived in queue (e.g. the save-round-trip
// row whose arrivalDay=25 — drive a high-gameDay tick to flip it).
await page.evaluate(() => globalThis.__uclife__.runShipDeliveryTick(1000))
while (curCap < capCap) {
  const snap = await page.evaluate(() => globalThis.__uclife__.deliverySnapshot())
  const idx = snap.findIndex((r) => r.hangarKey === drydock.buildingKey
    && r.shipClassId === 'pegasusClass' && r.status === 'arrived')
  if (idx < 0) {
    // Need to enqueue more to fill remaining slots.
    await page.evaluate(
      (k) => globalThis.__uclife__.enqueueShipDelivery(k, 'pegasusClass', 1100, 0),
      drydock.buildingKey,
    )
    await page.evaluate(() => globalThis.__uclife__.runShipDeliveryTick(1200))
    continue
  }
  const r = await page.evaluate(
    (arg) => globalThis.__uclife__.receiveShipDelivery(arg.k, arg.idx),
    { k: drydock.buildingKey, idx },
  )
  if (!r.ok) break
  curCap += 1
}
if (curCap !== capCap) {
  fail(`could not fill all ${capCap} capital slots — only filled to ${curCap}`)
} else pass(`filled all ${capCap} capital slots`)

// One more — should refuse with no_slot.
await page.evaluate((k) => globalThis.__uclife__.enqueueShipDelivery(k, 'pegasusClass', 2000, 0), drydock.buildingKey)
await page.evaluate(() => globalThis.__uclife__.runShipDeliveryTick(2100))
const blockSnap = await page.evaluate(() => globalThis.__uclife__.deliverySnapshot())
const blockIdx = blockSnap.findIndex((r) => r.hangarKey === drydock.buildingKey
  && r.shipClassId === 'pegasusClass' && r.status === 'arrived')
if (blockIdx < 0) fail(`expected at least one arrived row to test no_slot gate; queue: ${JSON.stringify(blockSnap)}`)
else {
  const blocked = await page.evaluate(
    (arg) => globalThis.__uclife__.receiveShipDelivery(arg.k, arg.idx),
    { k: drydock.buildingKey, idx: blockIdx },
  )
  if (blocked.ok !== false || blocked.reason !== 'no_slot') {
    fail(`expected no_slot at capacity ${curCap}/${capCap}, got: ${JSON.stringify(blocked)}`)
  } else pass(`receive at capacity → no_slot gate fires correctly`)
}

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
  console.log('\nOK: Pegasus buy → delivery → receive + fleet roster verified.')
}
