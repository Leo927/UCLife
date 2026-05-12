// Phase 6.2.E1 war-room plot table + IsInActiveFleet + aggression smoke.
// Drives every assertion through __uclife__ debug handles per CLAUDE.md
// smoke-test rules — no DOM scraping, no fixed sleeps, deterministic.
//
// Coverage:
//   1. Flagship starts in active fleet at the configured center slot;
//      non-flagship ships start in reserve with formationSlot = -1.
//   2. warRoomDescribe surfaces grid dims, occupancy map, all ship rows.
//   3. setIsInActiveFleet promotes a reserve ship; assigns a free slot.
//   4. setIsInActiveFleet auto-picks a slot when targetSlot is omitted.
//   5. setIsInActiveFleet demotes a ship; clears IsInActiveFleet marker
//      + resets formationSlot to -1.
//   6. setIsInActiveFleet refuses to demote the flagship.
//   7. setFormationSlot rejects the flagship's anchor slot.
//   8. setFormationSlot rejects an already-occupied slot.
//   9. setAggression accepts every authored aggression level.
//  10. setAggression rejects an invalid aggression id.
//  11. setWarRoomOpen toggles the modal open/close flag.
//  12. Save round-trip preserves IsInActiveFleet + formationSlot +
//      aggression.

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
  () => typeof globalThis.__uclife__?.fillJobVacancies === 'function'
    && typeof globalThis.__uclife__?.listShipsInFleet === 'function'
    && typeof globalThis.__uclife__?.listHangarsAllScenes === 'function'
    && typeof globalThis.__uclife__?.enqueueShipDelivery === 'function'
    && typeof globalThis.__uclife__?.runShipDeliveryTick === 'function'
    && typeof globalThis.__uclife__?.receiveShipDelivery === 'function'
    && typeof globalThis.__uclife__?.warRoomDescribe === 'function'
    && typeof globalThis.__uclife__?.setIsInActiveFleet === 'function'
    && typeof globalThis.__uclife__?.setFormationSlot === 'function'
    && typeof globalThis.__uclife__?.setShipAggression === 'function'
    && typeof globalThis.__uclife__?.setWarRoomOpen === 'function'
    && typeof globalThis.__uclife__?.fleetRosterSnapshot === 'function'
    && typeof globalThis.__uclife__?.cheatMoney === 'function'
    && typeof globalThis.__uclife__?.saveGame === 'function'
    && typeof globalThis.__uclife__?.loadGame === 'function',
  null,
  { timeout: 30_000 },
)

await page.evaluate(() => globalThis.__uclife__.useClock.getState().setSpeed(0))

const failures = []
const fail = (m) => failures.push(m)
const pass = (m) => console.log('PASS ' + m)

await page.evaluate(() => globalThis.__uclife__.cheatMoney(2_000_000))
await page.evaluate(() => globalThis.__uclife__.fillJobVacancies(['hangar_manager']))
await page.evaluate(() => globalThis.__uclife__.fillJobVacancies(['hangar_manager']))

// 0. Initial: just the flagship in the fleet.
const initialFleet = await page.evaluate(() => globalThis.__uclife__.listShipsInFleet())
if (initialFleet.length !== 1) {
  fail(`expected one starting ship; got ${initialFleet.length}`)
  await done()
}
const flagshipKey = initialFleet[0].entityKey

// 1. Flagship starts active at configured center slot.
const snap0 = await page.evaluate(() => globalThis.__uclife__.warRoomDescribe())
if (!snap0 || typeof snap0.flagshipSlot !== 'number') {
  fail(`warRoomDescribe missing flagshipSlot: ${JSON.stringify(snap0)}`)
  await done()
}
pass(`grid: ${snap0.cols}×${snap0.rows} · flagshipSlot=${snap0.flagshipSlot}`)

const flagshipRow0 = snap0.ships.find((r) => r.entityKey === flagshipKey)
if (!flagshipRow0?.isFlagship) fail('flagship row missing isFlagship marker')
else if (!flagshipRow0.isInActiveFleet) fail('flagship not in active fleet at boot')
else if (flagshipRow0.formationSlot !== snap0.flagshipSlot) {
  fail(`flagship formationSlot=${flagshipRow0.formationSlot} (want ${snap0.flagshipSlot})`)
} else pass(`flagship anchored at slot ${flagshipRow0.formationSlot}`)

if (snap0.occupancy[snap0.flagshipSlot] !== flagshipKey) {
  fail(`occupancy[flagshipSlot]=${snap0.occupancy[snap0.flagshipSlot]} (want ${flagshipKey})`)
} else pass('occupancy map anchors flagship at center slot')

// Spawn a second ship at the Granada drydock via the C2 buy pipeline.
const hangars = await page.evaluate(() => globalThis.__uclife__.listHangarsAllScenes())
const drydock = hangars.find((h) => h.typeId === 'hangarDrydock')
if (!drydock) { fail('Granada drydock missing'); await done() }

await page.evaluate((k) => globalThis.__uclife__.enqueueShipDelivery(k, 'pegasusClass', 1, 5), drydock.buildingKey)
await page.evaluate(() => globalThis.__uclife__.runShipDeliveryTick(6))
const rx = await page.evaluate((k) => globalThis.__uclife__.receiveShipDelivery(k, 0), drydock.buildingKey)
if (!rx.ok) { fail(`pegasus receive failed: ${JSON.stringify(rx)}`); await done() }
const pegasusKey = rx.entityKey

// 2. Newly-delivered ship starts in reserve with no formation slot.
const snap1 = await page.evaluate(() => globalThis.__uclife__.warRoomDescribe())
const pegRow1 = snap1.ships.find((r) => r.entityKey === pegasusKey)
if (!pegRow1) { fail('pegasus row missing'); await done() }
if (pegRow1.isInActiveFleet) fail('pegasus auto-joined active fleet (should be reserve)')
else pass('pegasus starts in reserve')
if (pegRow1.formationSlot !== -1) fail(`pegasus formationSlot=${pegRow1.formationSlot} (want -1)`)
else pass('pegasus formationSlot=-1 in reserve')
if (pegRow1.aggression !== 'steady') fail(`pegasus default aggression=${pegRow1.aggression} (want steady)`)
else pass('pegasus default aggression=steady')

// 3. Promote pegasus to slot 0 (top-left, non-flagship slot).
const promote0 = await page.evaluate(
  (args) => globalThis.__uclife__.setIsInActiveFleet(args.key, true, args.slot),
  { key: pegasusKey, slot: 0 },
)
if (!promote0.ok) fail(`promote pegasus → slot 0 failed: ${JSON.stringify(promote0)}`)
else if (promote0.formationSlot !== 0) fail(`promote returned slot=${promote0.formationSlot} (want 0)`)
else pass(`pegasus promoted to slot 0`)

const snap2 = await page.evaluate(() => globalThis.__uclife__.warRoomDescribe())
const pegRow2 = snap2.ships.find((r) => r.entityKey === pegasusKey)
if (!pegRow2.isInActiveFleet) fail('pegasus IsInActiveFleet marker not set after promote')
else if (pegRow2.formationSlot !== 0) fail(`pegasus formationSlot=${pegRow2.formationSlot} after promote (want 0)`)
else if (snap2.occupancy[0] !== pegasusKey) fail(`occupancy[0]=${snap2.occupancy[0]} (want ${pegasusKey})`)
else pass('promote reflected in occupancy map + ship row')

// 4. Demote pegasus → marker cleared, slot reset to -1.
const demote = await page.evaluate(
  (k) => globalThis.__uclife__.setIsInActiveFleet(k, false),
  pegasusKey,
)
if (!demote.ok) fail(`demote pegasus failed: ${JSON.stringify(demote)}`)
else pass('demote pegasus ok')

const snap3 = await page.evaluate(() => globalThis.__uclife__.warRoomDescribe())
const pegRow3 = snap3.ships.find((r) => r.entityKey === pegasusKey)
if (pegRow3.isInActiveFleet) fail('pegasus still marked active after demote')
else if (pegRow3.formationSlot !== -1) fail(`pegasus formationSlot=${pegRow3.formationSlot} after demote`)
else if (snap3.occupancy[0]) fail(`occupancy[0]=${snap3.occupancy[0]} after demote (want empty)`)
else pass('demote cleared marker + slot + occupancy')

// 5. Promote with no target slot → auto-pick first free slot.
const autoPromote = await page.evaluate(
  (k) => globalThis.__uclife__.setIsInActiveFleet(k, true),
  pegasusKey,
)
if (!autoPromote.ok) fail(`auto-promote pegasus failed: ${JSON.stringify(autoPromote)}`)
else if (autoPromote.formationSlot < 0) fail(`auto-promote slot=${autoPromote.formationSlot}`)
else if (autoPromote.formationSlot === snap0.flagshipSlot) {
  fail(`auto-promote landed on flagship slot ${autoPromote.formationSlot}`)
} else pass(`auto-promote chose slot ${autoPromote.formationSlot}`)

// 6. Flagship cannot be moved out of active fleet.
const flagshipDemote = await page.evaluate(
  (k) => globalThis.__uclife__.setIsInActiveFleet(k, false),
  flagshipKey,
)
if (flagshipDemote.ok) fail(`flagship demote should have been rejected; got ${JSON.stringify(flagshipDemote)}`)
else if (flagshipDemote.reason !== 'flagship_locked') {
  fail(`flagship demote rejected with reason=${flagshipDemote.reason} (want flagship_locked)`)
} else pass('flagship demote rejected with flagship_locked')

const snap4 = await page.evaluate(() => globalThis.__uclife__.warRoomDescribe())
const fl4 = snap4.ships.find((r) => r.entityKey === flagshipKey)
if (!fl4.isInActiveFleet) fail('flagship lost active marker after rejected demote!')
else if (fl4.formationSlot !== snap4.flagshipSlot) {
  fail(`flagship slot changed after rejected demote: ${fl4.formationSlot}`)
} else pass('flagship state intact after rejected demote')

// 7. setFormationSlot rejects flagship anchor slot for non-flagship.
const collide = await page.evaluate(
  (args) => globalThis.__uclife__.setFormationSlot(args.key, args.slot),
  { key: pegasusKey, slot: snap4.flagshipSlot },
)
if (collide.ok) fail(`moving pegasus onto flagship slot should reject: ${JSON.stringify(collide)}`)
else if (collide.reason !== 'slot_occupied') fail(`reject reason=${collide.reason} (want slot_occupied)`)
else pass('setFormationSlot rejected flagship slot collision')

// 8. setFormationSlot moves pegasus to a free slot (slot 0).
const move = await page.evaluate(
  (args) => globalThis.__uclife__.setFormationSlot(args.key, args.slot),
  { key: pegasusKey, slot: 0 },
)
if (!move.ok) fail(`setFormationSlot to free slot failed: ${JSON.stringify(move)}`)
else if (move.formationSlot !== 0) fail(`setFormationSlot returned ${move.formationSlot}`)
else pass('setFormationSlot moved pegasus to slot 0')

// 9. Aggression — each of the 3 levels round-trips.
for (const level of ['cautious', 'steady', 'aggressive']) {
  const r = await page.evaluate(
    (args) => globalThis.__uclife__.setShipAggression(args.key, args.level),
    { key: pegasusKey, level },
  )
  if (!r.ok) fail(`setAggression(${level}) failed: ${JSON.stringify(r)}`)
  else if (r.aggression !== level) fail(`setAggression returned ${r.aggression} (want ${level})`)
  else {
    const sn = await page.evaluate(() => globalThis.__uclife__.warRoomDescribe())
    const row = sn.ships.find((s) => s.entityKey === pegasusKey)
    if (row.aggression !== level) fail(`aggression not reflected in describe: ${row.aggression}`)
    else pass(`setAggression(${level}) round-trip ok`)
  }
}

// 10. setAggression rejects unknown level.
const badAgg = await page.evaluate(
  (args) => globalThis.__uclife__.setShipAggression(args.key, args.level),
  { key: pegasusKey, level: 'berserk' },
)
if (badAgg.ok) fail('setAggression accepted invalid level')
else if (badAgg.reason !== 'invalid_aggression') fail(`bad-aggression reason=${badAgg.reason}`)
else pass('setAggression rejected invalid level')

// 11. War-room modal toggle.
const opened = await page.evaluate(() => globalThis.__uclife__.setWarRoomOpen(true))
if (opened !== true) fail(`setWarRoomOpen(true) returned ${opened}`)
else pass('setWarRoomOpen(true) flipped the store flag')
const closed = await page.evaluate(() => globalThis.__uclife__.setWarRoomOpen(false))
if (closed !== false) fail(`setWarRoomOpen(false) returned ${closed}`)
else pass('setWarRoomOpen(false) flipped the store flag back')

// 12. Roster reflects state read-only.
const roster = await page.evaluate(() => globalThis.__uclife__.fleetRosterSnapshot())
const pegRosterRow = roster.find((r) => r.entityKey === pegasusKey)
if (!pegRosterRow) fail('pegasus missing from fleetRosterSnapshot')
else pass(`pegasus visible in roster snapshot · captainKey=${pegRosterRow.captainKey || '(empty)'}`)

// 13. Save round-trip preserves war-room state.
// Set pegasus to slot 2 + aggressive before save so the round-trip
// is meaningful (we can't tell apart "saved correctly" from "defaults
// restored" on a fresh-spawned ship at slot 0 + steady).
await page.evaluate((args) => globalThis.__uclife__.setFormationSlot(args.key, args.slot), { key: pegasusKey, slot: 2 })
await page.evaluate((args) => globalThis.__uclife__.setShipAggression(args.key, args.level), { key: pegasusKey, level: 'aggressive' })

const preSave = await page.evaluate(() => globalThis.__uclife__.warRoomDescribe())
const preSavePeg = preSave.ships.find((r) => r.entityKey === pegasusKey)
if (!preSavePeg.isInActiveFleet) fail('pre-save: pegasus not active')
if (preSavePeg.formationSlot !== 2) fail(`pre-save: pegasus slot=${preSavePeg.formationSlot} (want 2)`)
if (preSavePeg.aggression !== 'aggressive') fail(`pre-save: pegasus aggression=${preSavePeg.aggression}`)
pass(`pre-save state: pegasus active @ slot 2, aggression=aggressive`)

await page.evaluate(async () => { await globalThis.__uclife__.saveGame('auto') })
await page.evaluate(async () => { await globalThis.__uclife__.loadGame('auto') })

const postLoad = await page.evaluate(() => globalThis.__uclife__.warRoomDescribe())
const postPeg = postLoad.ships.find((r) => r.entityKey === pegasusKey)
const postFl = postLoad.ships.find((r) => r.entityKey === flagshipKey)
if (!postPeg) fail('save round-trip: pegasus missing from snapshot')
else {
  if (!postPeg.isInActiveFleet) fail('save round-trip: pegasus lost active marker')
  if (postPeg.formationSlot !== 2) fail(`save round-trip: pegasus slot=${postPeg.formationSlot}`)
  if (postPeg.aggression !== 'aggressive') fail(`save round-trip: pegasus aggression=${postPeg.aggression}`)
  if (postPeg.isInActiveFleet && postPeg.formationSlot === 2 && postPeg.aggression === 'aggressive') {
    pass('save round-trip preserved pegasus active + slot 2 + aggressive')
  }
}
if (!postFl) fail('save round-trip: flagship missing')
else if (!postFl.isInActiveFleet) fail('save round-trip: flagship lost active marker')
else if (postFl.formationSlot !== postLoad.flagshipSlot) {
  fail(`save round-trip: flagship slot=${postFl.formationSlot} (want ${postLoad.flagshipSlot})`)
} else pass('save round-trip preserved flagship active + center slot')

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
  console.log('\nOK: 6.2.E1 war-room + IsInActiveFleet + aggression verified.')
}
