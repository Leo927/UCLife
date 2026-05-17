// Phase 6.2.H — debug "grant fleet" function smoke. Drives the
// __uclife__.grantFleet handle and asserts the composed state matches
// the documented end-to-end fleet shape.
//
// Migrated to Phase 6 deterministic boot — ?test=1 freezes the clock,
// skips assets, and exposes __uclife_test__.step(). No setSpeed() pin
// needed; the loop is stopped already.
//
// Coverage:
//   1. First grantFleet() call → 2 new ships, captains assigned on each,
//      hangars supplied, Pegasus in active fleet.
//   2. Second grantFleet() call → refused with already_granted.
//   3. Save round-trip preserves the granted fleet.

import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1', baseUrl).toString()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.grantFleet === 'function'
    && typeof window.__uclife__?.listShipsInFleet === 'function'
    && typeof window.__uclife__?.fleetRosterSnapshot === 'function'
    && typeof window.__uclife__?.warRoomDescribe === 'function'
    && typeof window.__uclife__?.listHangarsAllScenes === 'function'
    && typeof window.__uclife__?.hangarSupplySnapshot === 'function'
    && typeof window.__uclife__?.saveGame === 'function'
    && typeof window.__uclife__?.loadGame === 'function',
  null,
  { timeout: 30_000 },
)

const before = await page.evaluate(() => window.__uclife__.listShipsInFleet())
assert.equal(
  before.length, 1,
  `baseline fleet should be one flagship; got ${before.length}: ${JSON.stringify(before)}`,
)

const grant = await page.evaluate(() => window.__uclife__.grantFleet())
assert.ok(grant?.ok, `first grantFleet() should succeed; got ${JSON.stringify(grant)}`)

const after = await page.evaluate(() => window.__uclife__.listShipsInFleet())
assert.equal(
  after.length, 3,
  `post-grant fleet should be 3 ships; got ${after.length}: ${JSON.stringify(after.map((s) => s.templateId))}`,
)

const pegasus = after.find((s) => s.templateId === 'pegasusClass')
const militia = after.find((s) => s.templateId === 'lunarMilitia')
assert.ok(pegasus, 'pegasus not in fleet after grant')
assert.equal(
  pegasus.dockedAtPoiId, 'granada',
  `pegasus dockedAtPoiId should be "granada"; got "${pegasus.dockedAtPoiId}"`,
)
assert.ok(militia, 'lunarMilitia not in fleet after grant')
assert.equal(
  militia.dockedAtPoiId, 'vonBraun',
  `lunarMilitia dockedAtPoiId should be "vonBraun"; got "${militia.dockedAtPoiId}"`,
)

const roster = await page.evaluate(() => window.__uclife__.fleetRosterSnapshot())
const pgRow = roster.find((r) => r.templateId === 'pegasusClass')
const lmRow = roster.find((r) => r.templateId === 'lunarMilitia')
assert.ok(pgRow?.captainKey, `pegasus has no captain after grant: ${JSON.stringify(pgRow)}`)
assert.ok(lmRow?.captainKey, `lunarMilitia has no captain after grant: ${JSON.stringify(lmRow)}`)

assert.ok(
  lmRow.crewCount >= 1,
  `lunarMilitia crew should be non-empty after grant; got ${lmRow.crewCount}`,
)
assert.ok(
  pgRow.crewCount >= 1,
  `pegasus crew should be non-empty after grant; got ${pgRow.crewCount}`,
)

const hangars = await page.evaluate(() => window.__uclife__.listHangarsAllScenes())
const vbHangar = hangars.find((h) => h.typeId === 'hangarSurface')
const drydock = hangars.find((h) => h.typeId === 'hangarDrydock')
assert.ok(vbHangar, 'VB surface hangar missing')
assert.ok(drydock, 'Granada drydock missing')

const vbSupply = await page.evaluate((k) => window.__uclife__.hangarSupplySnapshot(k), vbHangar.buildingKey)
const ddSupply = await page.evaluate((k) => window.__uclife__.hangarSupplySnapshot(k), drydock.buildingKey)
assert.equal(
  vbSupply.supplyCurrent, vbSupply.supplyMax,
  `VB hangar supply should be at max after grant; got ${vbSupply.supplyCurrent}/${vbSupply.supplyMax}`,
)
assert.equal(
  ddSupply.supplyCurrent, ddSupply.supplyMax,
  `drydock supply should be at max after grant; got ${ddSupply.supplyCurrent}/${ddSupply.supplyMax}`,
)

const wr = await page.evaluate(() => window.__uclife__.warRoomDescribe())
const pgWar = wr.ships.find((r) => r.templateId === 'pegasusClass')
assert.ok(pgWar?.isInActiveFleet, `pegasus should be in active fleet after grant: ${JSON.stringify(pgWar)}`)
assert.notEqual(
  pgWar.formationSlot, wr.flagshipSlot,
  `pegasus should not occupy flagship slot ${wr.flagshipSlot}`,
)

const grant2 = await page.evaluate(() => window.__uclife__.grantFleet())
assert.equal(grant2?.ok, false, `second grantFleet() should be refused; got ${JSON.stringify(grant2)}`)
assert.equal(
  grant2.reason, 'already_granted',
  `second grantFleet reason should be "already_granted"; got "${grant2.reason}"`,
)

await page.evaluate(async () => { await window.__uclife__.saveGame('auto') })
await page.evaluate(async () => { await window.__uclife__.loadGame('auto') })
await page.waitForFunction(
  () => typeof window.__uclife__?.listShipsInFleet === 'function',
  null,
  { timeout: 15_000 },
)

const afterLoad = await page.evaluate(() => window.__uclife__.listShipsInFleet())
assert.equal(
  afterLoad.length, 3,
  `post-load fleet count should be 3; got ${afterLoad.length}`,
)

const rosterLoad = await page.evaluate(() => window.__uclife__.fleetRosterSnapshot())
const pgLoad = rosterLoad.find((r) => r.templateId === 'pegasusClass')
const lmLoad = rosterLoad.find((r) => r.templateId === 'lunarMilitia')
assert.ok(pgLoad?.captainKey, 'pegasus captain not preserved across save/load')
assert.ok(lmLoad?.captainKey, 'lunarMilitia captain not preserved across save/load')

const wrLoad = await page.evaluate(() => window.__uclife__.warRoomDescribe())
const pgWarLoad = wrLoad.ships.find((r) => r.templateId === 'pegasusClass')
assert.ok(
  pgWarLoad?.isInActiveFleet,
  `pegasus active-fleet marker not preserved across save/load: ${JSON.stringify(pgWarLoad)}`,
)

assert.equal(
  errors.length, 0,
  `page error(s) during test:\n${errors.map((e) => '  ' + e).join('\n')}`,
)

await browser.close()

console.log('OK — check-grant-fleet:')
console.log(`  fleet size: ${afterLoad.length} (flagship + lunarMilitia + pegasus)`)
console.log(`  captains preserved: pegasus=${pgLoad.captainKey} militia=${lmLoad.captainKey}`)
console.log(`  pegasus active-fleet slot post-load: ${pgWarLoad.formationSlot}`)
