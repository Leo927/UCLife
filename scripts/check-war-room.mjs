// Phase 6.2.E1 war-room plot table + IsInActiveFleet + aggression smoke.
// All assertions go through __uclife__ debug handles — frozen clock,
// no DOM scraping, no real-time sleeps.

import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import { BOOT_READY_TIMEOUT_MS } from './_test-constants.mjs'

const DRYDOCK_DELIVERY_DAYS = 1
const DRYDOCK_RUN_TICK_DAY = 6
const PROMOTE_SLOT_TOPLEFT = 0
const SAVE_RESTORE_SLOT = 2
const STARTUP_MONEY = 2_000_000

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1', baseUrl).toString()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console.error: ${m.text()}`) })

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.fillJobVacancies === 'function'
    && typeof window.__uclife__?.listShipsInFleet === 'function'
    && typeof window.__uclife__?.listHangarsAllScenes === 'function'
    && typeof window.__uclife__?.enqueueShipDelivery === 'function'
    && typeof window.__uclife__?.runShipDeliveryTick === 'function'
    && typeof window.__uclife__?.receiveShipDelivery === 'function'
    && typeof window.__uclife__?.warRoomDescribe === 'function'
    && typeof window.__uclife__?.setIsInActiveFleet === 'function'
    && typeof window.__uclife__?.setFormationSlot === 'function'
    && typeof window.__uclife__?.setShipAggression === 'function'
    && typeof window.__uclife__?.setWarRoomOpen === 'function'
    && typeof window.__uclife__?.fleetRosterSnapshot === 'function'
    && typeof window.__uclife__?.cheatMoney === 'function'
    && typeof window.__uclife__?.saveGame === 'function'
    && typeof window.__uclife__?.loadGame === 'function',
  null, { timeout: BOOT_READY_TIMEOUT_MS },
)

await page.evaluate((amt) => window.__uclife__.cheatMoney(amt), STARTUP_MONEY)
await page.evaluate(() => window.__uclife__.fillJobVacancies(['hangar_manager']))
await page.evaluate(() => window.__uclife__.fillJobVacancies(['hangar_manager']))

const initialFleet = await page.evaluate(() => window.__uclife__.listShipsInFleet())
assert.equal(initialFleet.length, 1, `expected one starting ship; got ${initialFleet.length}`)
const flagshipKey = initialFleet[0].entityKey

const snap0 = await page.evaluate(() => window.__uclife__.warRoomDescribe())
assert.equal(typeof snap0.flagshipSlot, 'number', `warRoomDescribe missing flagshipSlot: ${JSON.stringify(snap0)}`)
console.log(`grid: ${snap0.cols}×${snap0.rows} · flagshipSlot=${snap0.flagshipSlot}`)

const flagshipRow0 = snap0.ships.find((r) => r.entityKey === flagshipKey)
assert.ok(flagshipRow0?.isFlagship, 'flagship row missing isFlagship marker')
assert.ok(flagshipRow0.isInActiveFleet, 'flagship not in active fleet at boot')
assert.equal(flagshipRow0.formationSlot, snap0.flagshipSlot,
  `flagship formationSlot=${flagshipRow0.formationSlot} (want ${snap0.flagshipSlot})`)
assert.equal(snap0.occupancy[snap0.flagshipSlot], flagshipKey,
  `occupancy[flagshipSlot]=${snap0.occupancy[snap0.flagshipSlot]} (want ${flagshipKey})`)

const hangars = await page.evaluate(() => window.__uclife__.listHangarsAllScenes())
const drydock = hangars.find((h) => h.typeId === 'hangarDrydock')
assert.ok(drydock, 'Granada drydock missing')

await page.evaluate(
  (args) => window.__uclife__.enqueueShipDelivery(args.k, 'pegasusClass', args.days, 5),
  { k: drydock.buildingKey, days: DRYDOCK_DELIVERY_DAYS },
)
await page.evaluate(
  (day) => window.__uclife__.runShipDeliveryTick(day),
  DRYDOCK_RUN_TICK_DAY,
)
const rx = await page.evaluate(
  (k) => window.__uclife__.receiveShipDelivery(k, 0),
  drydock.buildingKey,
)
assert.equal(rx.ok, true, `pegasus receive failed: ${JSON.stringify(rx)}`)
const pegasusKey = rx.entityKey

const snap1 = await page.evaluate(() => window.__uclife__.warRoomDescribe())
const pegRow1 = snap1.ships.find((r) => r.entityKey === pegasusKey)
assert.ok(pegRow1, 'pegasus row missing')
assert.equal(pegRow1.isInActiveFleet, false, 'pegasus auto-joined active fleet (should be reserve)')
assert.equal(pegRow1.formationSlot, -1, `pegasus formationSlot=${pegRow1.formationSlot} (want -1)`)
assert.equal(pegRow1.aggression, 'steady', `pegasus default aggression=${pegRow1.aggression}`)

const promote0 = await page.evaluate(
  (args) => window.__uclife__.setIsInActiveFleet(args.key, true, args.slot),
  { key: pegasusKey, slot: PROMOTE_SLOT_TOPLEFT },
)
assert.equal(promote0.ok, true, `promote pegasus → slot ${PROMOTE_SLOT_TOPLEFT} failed: ${JSON.stringify(promote0)}`)
assert.equal(promote0.formationSlot, PROMOTE_SLOT_TOPLEFT, `promote returned slot=${promote0.formationSlot}`)

const snap2 = await page.evaluate(() => window.__uclife__.warRoomDescribe())
const pegRow2 = snap2.ships.find((r) => r.entityKey === pegasusKey)
assert.ok(pegRow2.isInActiveFleet, 'pegasus IsInActiveFleet marker not set after promote')
assert.equal(pegRow2.formationSlot, PROMOTE_SLOT_TOPLEFT,
  `pegasus formationSlot=${pegRow2.formationSlot} after promote`)
assert.equal(snap2.occupancy[PROMOTE_SLOT_TOPLEFT], pegasusKey,
  `occupancy[${PROMOTE_SLOT_TOPLEFT}]=${snap2.occupancy[PROMOTE_SLOT_TOPLEFT]}`)

const demote = await page.evaluate(
  (k) => window.__uclife__.setIsInActiveFleet(k, false),
  pegasusKey,
)
assert.equal(demote.ok, true, `demote pegasus failed: ${JSON.stringify(demote)}`)

const snap3 = await page.evaluate(() => window.__uclife__.warRoomDescribe())
const pegRow3 = snap3.ships.find((r) => r.entityKey === pegasusKey)
assert.equal(pegRow3.isInActiveFleet, false, 'pegasus still marked active after demote')
assert.equal(pegRow3.formationSlot, -1, `pegasus formationSlot=${pegRow3.formationSlot} after demote`)
assert.ok(!snap3.occupancy[PROMOTE_SLOT_TOPLEFT],
  `occupancy[${PROMOTE_SLOT_TOPLEFT}]=${snap3.occupancy[PROMOTE_SLOT_TOPLEFT]} after demote`)

const autoPromote = await page.evaluate(
  (k) => window.__uclife__.setIsInActiveFleet(k, true),
  pegasusKey,
)
assert.equal(autoPromote.ok, true, `auto-promote pegasus failed: ${JSON.stringify(autoPromote)}`)
assert.ok(autoPromote.formationSlot >= 0, `auto-promote slot=${autoPromote.formationSlot}`)
assert.notEqual(autoPromote.formationSlot, snap0.flagshipSlot,
  `auto-promote landed on flagship slot ${autoPromote.formationSlot}`)

const flagshipDemote = await page.evaluate(
  (k) => window.__uclife__.setIsInActiveFleet(k, false),
  flagshipKey,
)
assert.equal(flagshipDemote.ok, false, `flagship demote should have been rejected; got ${JSON.stringify(flagshipDemote)}`)
assert.equal(flagshipDemote.reason, 'flagship_locked',
  `flagship demote rejected with reason=${flagshipDemote.reason}`)

const snap4 = await page.evaluate(() => window.__uclife__.warRoomDescribe())
const fl4 = snap4.ships.find((r) => r.entityKey === flagshipKey)
assert.ok(fl4.isInActiveFleet, 'flagship lost active marker after rejected demote!')
assert.equal(fl4.formationSlot, snap4.flagshipSlot,
  `flagship slot changed after rejected demote: ${fl4.formationSlot}`)

const collide = await page.evaluate(
  (args) => window.__uclife__.setFormationSlot(args.key, args.slot),
  { key: pegasusKey, slot: snap4.flagshipSlot },
)
assert.equal(collide.ok, false, `moving pegasus onto flagship slot should reject: ${JSON.stringify(collide)}`)
assert.equal(collide.reason, 'slot_occupied', `reject reason=${collide.reason}`)

const move = await page.evaluate(
  (args) => window.__uclife__.setFormationSlot(args.key, args.slot),
  { key: pegasusKey, slot: PROMOTE_SLOT_TOPLEFT },
)
assert.equal(move.ok, true, `setFormationSlot to free slot failed: ${JSON.stringify(move)}`)
assert.equal(move.formationSlot, PROMOTE_SLOT_TOPLEFT, `setFormationSlot returned ${move.formationSlot}`)

for (const level of ['cautious', 'steady', 'aggressive']) {
  const r = await page.evaluate(
    (args) => window.__uclife__.setShipAggression(args.key, args.level),
    { key: pegasusKey, level },
  )
  assert.equal(r.ok, true, `setAggression(${level}) failed: ${JSON.stringify(r)}`)
  assert.equal(r.aggression, level, `setAggression returned ${r.aggression}`)
  const sn = await page.evaluate(() => window.__uclife__.warRoomDescribe())
  const row = sn.ships.find((s) => s.entityKey === pegasusKey)
  assert.equal(row.aggression, level, `aggression not reflected in describe: ${row.aggression}`)
}

const badAgg = await page.evaluate(
  (args) => window.__uclife__.setShipAggression(args.key, args.level),
  { key: pegasusKey, level: 'berserk' },
)
assert.equal(badAgg.ok, false, 'setAggression accepted invalid level')
assert.equal(badAgg.reason, 'invalid_aggression', `bad-aggression reason=${badAgg.reason}`)

const opened = await page.evaluate(() => window.__uclife__.setWarRoomOpen(true))
assert.equal(opened, true, `setWarRoomOpen(true) returned ${opened}`)
const closed = await page.evaluate(() => window.__uclife__.setWarRoomOpen(false))
assert.equal(closed, false, `setWarRoomOpen(false) returned ${closed}`)

const roster = await page.evaluate(() => window.__uclife__.fleetRosterSnapshot())
const pegRosterRow = roster.find((r) => r.entityKey === pegasusKey)
assert.ok(pegRosterRow, 'pegasus missing from fleetRosterSnapshot')

await page.evaluate(
  (args) => window.__uclife__.setFormationSlot(args.key, args.slot),
  { key: pegasusKey, slot: SAVE_RESTORE_SLOT },
)
await page.evaluate(
  (args) => window.__uclife__.setShipAggression(args.key, args.level),
  { key: pegasusKey, level: 'aggressive' },
)

const preSave = await page.evaluate(() => window.__uclife__.warRoomDescribe())
const preSavePeg = preSave.ships.find((r) => r.entityKey === pegasusKey)
assert.ok(preSavePeg.isInActiveFleet, 'pre-save: pegasus not active')
assert.equal(preSavePeg.formationSlot, SAVE_RESTORE_SLOT, `pre-save: pegasus slot=${preSavePeg.formationSlot}`)
assert.equal(preSavePeg.aggression, 'aggressive', `pre-save: pegasus aggression=${preSavePeg.aggression}`)

await page.evaluate(async () => { await window.__uclife__.saveGame('auto') })
const loadRes = await page.evaluate(async () => window.__uclife__.loadGame('auto'))
assert.equal(loadRes.ok, true, `loadGame failed: ${JSON.stringify(loadRes)}`)

const postLoad = await page.evaluate(() => window.__uclife__.warRoomDescribe())
const postPeg = postLoad.ships.find((r) => r.entityKey === pegasusKey)
const postFl = postLoad.ships.find((r) => r.entityKey === flagshipKey)
assert.ok(postPeg, 'save round-trip: pegasus missing from snapshot')
assert.ok(postPeg.isInActiveFleet, 'save round-trip: pegasus lost active marker')
assert.equal(postPeg.formationSlot, SAVE_RESTORE_SLOT, `save round-trip: pegasus slot=${postPeg.formationSlot}`)
assert.equal(postPeg.aggression, 'aggressive', `save round-trip: pegasus aggression=${postPeg.aggression}`)
assert.ok(postFl, 'save round-trip: flagship missing')
assert.ok(postFl.isInActiveFleet, 'save round-trip: flagship lost active marker')
assert.equal(postFl.formationSlot, postLoad.flagshipSlot,
  `save round-trip: flagship slot=${postFl.formationSlot}`)

assert.equal(pageErrors.length, 0,
  `page error(s) during test:\n${pageErrors.map((e) => '  ' + e).join('\n')}`)

await browser.close()

console.log('\nOK: 6.2.E1 war-room + IsInActiveFleet + aggression verified.')
