import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import { BOOT_READY_TIMEOUT_MS, SAVE_LOAD_READY_TIMEOUT_MS, VIEWPORT } from './_test-constants.mjs'

// Phase 6.2.G mothball + hangar transfer smoke — migrated to the
// deterministic API (Phase 6, Category A). The sim clock is frozen by
// ?test=1; every time-advancing verb is a tick-targeted call (e.g.
// runShipDeliveryTick, runFleetTransitTick, runFleetCrewSalaryTick).
//
// Coverage:
//   1. Mothball a non-flagship ship → IsInActiveFleet cleared,
//      Ship.mothballed=true, daily supply drain skips the ship + daily
//      salary tick skips its salaries.
//   2. Try to mothball the flagship → refused with flagship_locked.
//   3. Un-mothball → drain resumes, salary resumes.
//   4. Transfer ship VB → Granada via the hangar transfer surface.
//   5. Transfer to a full hangar → refused with dest_no_slot.
//   6. Transfer a mothballed ship → refused with mothballed.
//   7. Transfer a ship in transit → refused with in_transit.
//   8. Save round-trip: mothball state survives.

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1', baseUrl).toString()

const CHEAT_MONEY = 5_000_000
const ORDER_DAY_SHIP_A = 1
const SMALL_HULL_LEAD_DAYS = 2
const ARRIVAL_DAY_SHIP_A = ORDER_DAY_SHIP_A + SMALL_HULL_LEAD_DAYS
const SALARY_TICK_DAY_PRE = 1
const SALARY_TICK_DAY_POST = 2
const SALARY_TICK_DAY_RESUMED = 3
const TRANSFER_ORDER_DAY = 5
const MOTH_TRANSFER_ORDER_DAY = 10
const FULL_TRANSFER_ORDER_DAY = 11
const VB_FILL_CAP = 4
const SHIP_B_ORDER_DAY = 11
const SHIP_B_ARRIVAL_DAY = SHIP_B_ORDER_DAY + SMALL_HULL_LEAD_DAYS

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: VIEWPORT })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })

await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.fillJobVacancies === 'function'
    && typeof window.__uclife__?.listShipsInFleet === 'function'
    && typeof window.__uclife__?.listHangarsAllScenes === 'function'
    && typeof window.__uclife__?.enqueueShipDelivery === 'function'
    && typeof window.__uclife__?.runShipDeliveryTick === 'function'
    && typeof window.__uclife__?.receiveShipDelivery === 'function'
    && typeof window.__uclife__?.setIsInActiveFleet === 'function'
    && typeof window.__uclife__?.setShipMothballedViaDebug === 'function'
    && typeof window.__uclife__?.isShipMothballed === 'function'
    && typeof window.__uclife__?.listTransferDestinationsViaDebug === 'function'
    && typeof window.__uclife__?.enqueueHangarTransferViaDebug === 'function'
    && typeof window.__uclife__?.runFleetSupplyDrainTick === 'function'
    && typeof window.__uclife__?.runFleetCrewSalaryTick === 'function'
    && typeof window.__uclife__?.runFleetTransitTick === 'function'
    && typeof window.__uclife__?.fleetTransitDescribe === 'function'
    && typeof window.__uclife__?.warRoomDescribe === 'function'
    && typeof window.__uclife__?.spawnTestNpc === 'function'
    && typeof window.__uclife__?.hireCaptainViaDebug === 'function'
    && typeof window.__uclife__?.hireCrewViaDebug === 'function'
    && typeof window.__uclife__?.cheatMoney === 'function'
    && typeof window.__uclife__?.saveGame === 'function'
    && typeof window.__uclife__?.loadGame === 'function'
    && typeof window.__uclife__?.forceFillHangarSlots === 'function',
  null,
  { timeout: BOOT_READY_TIMEOUT_MS },
)

await page.evaluate((n) => window.__uclife__.cheatMoney(n), CHEAT_MONEY)
await page.evaluate(() => window.__uclife__.fillJobVacancies(['hangar_manager']))
await page.evaluate(() => window.__uclife__.fillJobVacancies(['hangar_manager']))

const initialFleet = await page.evaluate(() => window.__uclife__.listShipsInFleet())
assert.equal(initialFleet.length, 1,
  `expected one starting ship; got ${initialFleet.length}`)
const flagshipKey = initialFleet[0].entityKey

const hangars = await page.evaluate(() => window.__uclife__.listHangarsAllScenes())
const vbHangar = hangars.find((h) => h.typeId === 'hangarSurface')
const drydock = hangars.find((h) => h.typeId === 'hangarDrydock')
assert.ok(vbHangar, 'VB hangar missing')
assert.ok(drydock, 'Granada drydock missing')

await page.evaluate(
  (arg) => window.__uclife__.enqueueShipDelivery(arg.k, 'lunarMilitia', arg.orderDay, arg.lead),
  { k: vbHangar.buildingKey, orderDay: ORDER_DAY_SHIP_A, lead: SMALL_HULL_LEAD_DAYS },
)
await page.evaluate((d) => window.__uclife__.runShipDeliveryTick(d), ARRIVAL_DAY_SHIP_A)
const rxA = await page.evaluate(
  (k) => window.__uclife__.receiveShipDelivery(k, 0), vbHangar.buildingKey,
)
assert.ok(rxA.ok, `Ship A receive failed: ${JSON.stringify(rxA)}`)
const shipAKey = rxA.entityKey

await page.evaluate(() => window.__uclife__.spawnTestNpc({ key: 'npc-captain', name: 'Captain Test' }))
await page.evaluate(() => window.__uclife__.spawnTestNpc({ key: 'npc-crew', name: 'Crew Test' }))
const hireCap = await page.evaluate(
  ([n, s]) => window.__uclife__.hireCaptainViaDebug(n, s), ['npc-captain', shipAKey],
)
assert.ok(hireCap.ok, `hire captain failed: ${JSON.stringify(hireCap)}`)
const hireCrew = await page.evaluate(
  ([n, s]) => window.__uclife__.hireCrewViaDebug(n, s), ['npc-crew', shipAKey],
)
assert.ok(hireCrew.ok, `hire crew failed: ${JSON.stringify(hireCrew)}`)

await page.evaluate((k) => window.__uclife__.setIsInActiveFleet(k, true), shipAKey)
const wrPre = await page.evaluate(() => window.__uclife__.warRoomDescribe())
const aRowPre = wrPre.ships.find((r) => r.entityKey === shipAKey)
assert.ok(aRowPre?.isInActiveFleet,
  `Ship A not promoted to active fleet: ${JSON.stringify(aRowPre)}`)

const salaryPre = await page.evaluate(
  (d) => window.__uclife__.runFleetCrewSalaryTick(d), SALARY_TICK_DAY_PRE,
)
assert.ok(salaryPre.captainsPaid >= 1,
  `expected at least 1 captain paid pre-mothball; got ${salaryPre.captainsPaid}`)
assert.ok(salaryPre.crewPaid >= 1,
  `expected at least 1 crew paid pre-mothball; got ${salaryPre.crewPaid}`)
assert.ok(salaryPre.totalDebit > 0,
  `expected positive salary debit pre-mothball; got ${salaryPre.totalDebit}`)

const drainPre = await page.evaluate(
  (d) => window.__uclife__.runFleetSupplyDrainTick(d), SALARY_TICK_DAY_PRE,
)
const drainPreCount = drainPre.shipsDraining
assert.ok(drainPreCount >= 1,
  `expected ≥1 draining ships pre-mothball; got ${drainPreCount}`)

const mothA = await page.evaluate(
  (k) => window.__uclife__.setShipMothballedViaDebug(k, true), shipAKey,
)
assert.ok(mothA.ok, `mothball A failed: ${JSON.stringify(mothA)}`)
assert.equal(mothA.mothballed, true,
  `mothball result.mothballed should be true; got ${mothA.mothballed}`)
const isMothA = await page.evaluate(
  (k) => window.__uclife__.isShipMothballed(k), shipAKey,
)
assert.equal(isMothA, true, `Ship A.mothballed read back ≠ true: ${isMothA}`)

const wrPost = await page.evaluate(() => window.__uclife__.warRoomDescribe())
const aRowPost = wrPost.ships.find((r) => r.entityKey === shipAKey)
assert.ok(!aRowPost?.isInActiveFleet,
  `Ship A still in active fleet after mothball: ${JSON.stringify(aRowPost)}`)
assert.equal(aRowPost?.formationSlot, -1,
  `Ship A formationSlot ≠ -1: ${aRowPost?.formationSlot}`)

const mothFlag = await page.evaluate(
  (k) => window.__uclife__.setShipMothballedViaDebug(k, true), flagshipKey,
)
assert.ok(!mothFlag.ok,
  `flagship mothball should have been refused; got ${JSON.stringify(mothFlag)}`)
assert.equal(mothFlag.reason, 'flagship_locked',
  `flagship mothball refused with unexpected reason: ${mothFlag.reason}`)

const salaryPost = await page.evaluate(
  (d) => window.__uclife__.runFleetCrewSalaryTick(d), SALARY_TICK_DAY_POST,
)
assert.equal(salaryPost.captainsPaid, 0,
  `expected 0 captains paid post-mothball; got ${salaryPost.captainsPaid}`)
assert.equal(salaryPost.crewPaid, 0,
  `expected 0 crew paid post-mothball; got ${salaryPost.crewPaid}`)
assert.equal(salaryPost.totalDebit, 0,
  `expected zero salary debit post-mothball; got ${salaryPost.totalDebit}`)

const drainPost = await page.evaluate(
  (d) => window.__uclife__.runFleetSupplyDrainTick(d), SALARY_TICK_DAY_POST,
)
assert.ok(drainPost.shipsDraining < drainPreCount,
  `expected drain ship count to drop post-mothball; got pre=${drainPreCount} post=${drainPost.shipsDraining}`)

const unmothA = await page.evaluate(
  (k) => window.__uclife__.setShipMothballedViaDebug(k, false), shipAKey,
)
assert.ok(unmothA.ok, `un-mothball A failed: ${JSON.stringify(unmothA)}`)
const isMothPostUn = await page.evaluate(
  (k) => window.__uclife__.isShipMothballed(k), shipAKey,
)
assert.equal(isMothPostUn, false,
  `Ship A mothballed flag not cleared on un-mothball: ${isMothPostUn}`)

const salaryReact = await page.evaluate(
  (d) => window.__uclife__.runFleetCrewSalaryTick(d), SALARY_TICK_DAY_RESUMED,
)
assert.ok(salaryReact.totalDebit > 0,
  `expected positive salary debit after un-mothball; got ${salaryReact.totalDebit}`)

const repromote = await page.evaluate(
  (k) => window.__uclife__.setIsInActiveFleet(k, true), shipAKey,
)
assert.ok(repromote.ok,
  `re-promote Ship A to active fleet failed: ${JSON.stringify(repromote)}`)

await page.evaluate((k) => window.__uclife__.setIsInActiveFleet(k, false), shipAKey)

const destsForA = await page.evaluate(
  (k) => window.__uclife__.listTransferDestinationsViaDebug(k), shipAKey,
)
const granadaDest = destsForA.find((d) => d.poiId === 'granada')
assert.ok(granadaDest,
  `granada not in transfer destinations for A: ${JSON.stringify(destsForA)}`)
assert.ok(granadaDest.hasOpenSlot,
  `granada destination reports no open slot pre-transfer: ${JSON.stringify(granadaDest)}`)

const transferA = await page.evaluate(
  ([k, dest, day]) => window.__uclife__.enqueueHangarTransferViaDebug(k, dest, day),
  [shipAKey, 'granada', TRANSFER_ORDER_DAY],
)
assert.ok(transferA.ok, `transfer A → granada failed: ${JSON.stringify(transferA)}`)
const expectedTotal = transferA.transferFee + transferA.transitFee
assert.equal(transferA.totalCost, expectedTotal,
  `transfer totalCost ${transferA.totalCost} ≠ transferFee+transitFee ${expectedTotal}`)
assert.ok(transferA.arrivalDay > TRANSFER_ORDER_DAY,
  `transfer arrivalDay should be > order day ${TRANSFER_ORDER_DAY}; got ${transferA.arrivalDay}`)

const fleetMid = await page.evaluate(() => window.__uclife__.listShipsInFleet())
const aMid = fleetMid.find((s) => s.entityKey === shipAKey)
assert.ok(aMid && aMid.dockedAtPoiId === '',
  `Ship A not undocked after transfer: ${aMid?.dockedAtPoiId}`)

const transitsMid = await page.evaluate(() => window.__uclife__.fleetTransitDescribe())
const tMid = transitsMid.find((t) => t.shipKey === shipAKey)
assert.ok(tMid, `Ship A not in transit list: ${JSON.stringify(transitsMid)}`)
assert.equal(tMid.originPoiId, 'vonBraun',
  `Ship A transit origin ${tMid.originPoiId} ≠ vonBraun`)
assert.equal(tMid.destinationPoiId, 'granada',
  `Ship A transit dest ${tMid.destinationPoiId} ≠ granada`)

const transferInTransit = await page.evaluate(
  ([k, day]) => window.__uclife__.enqueueHangarTransferViaDebug(k, 'granada', day),
  [shipAKey, TRANSFER_ORDER_DAY],
)
assert.ok(!transferInTransit.ok,
  `transfer of in-transit ship should be refused; got ${JSON.stringify(transferInTransit)}`)
assert.ok(['in_transit', 'already_in_transit'].includes(transferInTransit.reason),
  `transfer of in-transit refused with unexpected reason: ${transferInTransit.reason}`)

const landResult = await page.evaluate(
  (day) => window.__uclife__.runFleetTransitTick(day),
  transferA.arrivalDay,
)
assert.ok(landResult.landed >= 1,
  `expected ≥1 ship landed on arrivalDay; got ${landResult.landed}`)
const fleetPost = await page.evaluate(() => window.__uclife__.listShipsInFleet())
const aPost = fleetPost.find((s) => s.entityKey === shipAKey)
assert.equal(aPost?.dockedAtPoiId, 'granada',
  `Ship A not docked at granada post-land: ${aPost?.dockedAtPoiId}`)

await page.evaluate((k) => window.__uclife__.setShipMothballedViaDebug(k, true), shipAKey)
const transferMoth = await page.evaluate(
  ([k, day]) => window.__uclife__.enqueueHangarTransferViaDebug(k, 'vonBraun', day),
  [shipAKey, MOTH_TRANSFER_ORDER_DAY],
)
assert.ok(!transferMoth.ok,
  `transfer of mothballed ship should be refused; got ${JSON.stringify(transferMoth)}`)
assert.equal(transferMoth.reason, 'mothballed',
  `transfer of mothballed refused with unexpected reason: ${transferMoth.reason}`)

await page.evaluate((k) => window.__uclife__.setShipMothballedViaDebug(k, false), shipAKey)
await page.evaluate(
  (cap) => window.__uclife__.forceFillHangarSlots('vonBraun', 'lunarMilitia', cap),
  VB_FILL_CAP,
)
const destsFull = await page.evaluate(
  (k) => window.__uclife__.listTransferDestinationsViaDebug(k), shipAKey,
)
const vbDestFull = destsFull.find((d) => d.poiId === 'vonBraun')
assert.ok(vbDestFull,
  `vonBraun missing from transfer destinations after fill: ${JSON.stringify(destsFull)}`)
assert.ok(!vbDestFull.hasOpenSlot,
  `vonBraun should report no open slot after fill; got slot ${vbDestFull.slotOccupancy}/${vbDestFull.slotCapacity}`)

const transferFull = await page.evaluate(
  ([k, day]) => window.__uclife__.enqueueHangarTransferViaDebug(k, 'vonBraun', day),
  [shipAKey, FULL_TRANSFER_ORDER_DAY],
)
assert.ok(!transferFull.ok,
  `transfer to full hangar should be refused; got ${JSON.stringify(transferFull)}`)
assert.equal(transferFull.reason, 'dest_no_slot',
  `transfer to full hangar refused with unexpected reason: ${transferFull.reason}`)

await page.evaluate(
  (arg) => window.__uclife__.enqueueShipDelivery(arg.k, 'lunarMilitia', arg.orderDay, arg.lead),
  { k: drydock.buildingKey, orderDay: SHIP_B_ORDER_DAY, lead: SMALL_HULL_LEAD_DAYS },
)
await page.evaluate((d) => window.__uclife__.runShipDeliveryTick(d), SHIP_B_ARRIVAL_DAY)
const rxB = await page.evaluate(
  (k) => window.__uclife__.receiveShipDelivery(k, 0), drydock.buildingKey,
)
assert.ok(rxB.ok, `Ship B receive failed: ${JSON.stringify(rxB)}`)

await page.evaluate((k) => window.__uclife__.setShipMothballedViaDebug(k, true), shipAKey)

const aPreSave = await page.evaluate((k) => window.__uclife__.isShipMothballed(k), shipAKey)
assert.equal(aPreSave, true, `Ship A mothballed pre-save should be true; got ${aPreSave}`)

await page.evaluate(async () => { await window.__uclife__.saveGame('auto') })
await page.evaluate(async () => { await window.__uclife__.loadGame('auto') })

await page.waitForFunction(
  () => typeof window.__uclife__?.isShipMothballed === 'function',
  null, { timeout: SAVE_LOAD_READY_TIMEOUT_MS },
)

const aPostLoad = await page.evaluate(
  (k) => window.__uclife__.isShipMothballed(k), shipAKey,
)
assert.equal(aPostLoad, true,
  `Ship A mothballed post-load should be true; got ${aPostLoad}`)

assert.equal(errors.length, 0,
  `page error(s) during test:\n${errors.map((e) => '  ' + e).join('\n')}`)

console.log('OK — check-mothball-transfer:')
console.log(`  flagship: ${flagshipKey}`)
console.log(`  ship A (lunarMilitia): ${shipAKey} mothball → transfer → land cycle verified`)
console.log(`  ship B (lunarMilitia): ${rxB.entityKey} delivered at granada`)
console.log(`  mothball state survived save/load`)

await browser.close()
