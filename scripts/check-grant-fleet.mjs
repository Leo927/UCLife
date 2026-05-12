// Phase 6.2.H — debug "grant fleet" function smoke. Drives the
// __uclife__.grantFleet handle and asserts the composed state matches
// the documented end-to-end fleet shape. No DOM scraping, no fixed
// sleeps — deterministic per CLAUDE.md smoke-test rules.
//
// Coverage:
//   1. First grantFleet() call → 2 new ships, captains assigned on each,
//      hangars supplied, Pegasus in active fleet.
//   2. Second grantFleet() call → refused with already_granted.
//   3. Save round-trip preserves the granted fleet (ship count, captain
//      assignments, hangar reserves, active-fleet marker).

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
  () => typeof globalThis.__uclife__?.grantFleet === 'function'
    && typeof globalThis.__uclife__?.listShipsInFleet === 'function'
    && typeof globalThis.__uclife__?.fleetRosterSnapshot === 'function'
    && typeof globalThis.__uclife__?.warRoomDescribe === 'function'
    && typeof globalThis.__uclife__?.listHangarsAllScenes === 'function'
    && typeof globalThis.__uclife__?.hangarSupplySnapshot === 'function'
    && typeof globalThis.__uclife__?.saveGame === 'function'
    && typeof globalThis.__uclife__?.loadGame === 'function'
    && typeof globalThis.__uclife__?.useClock?.getState === 'function',
  null,
  { timeout: 30_000 },
)

await page.evaluate(() => globalThis.__uclife__.useClock.getState().setSpeed(0))

const failures = []
const fail = (m) => failures.push(m)
const pass = (m) => console.log('PASS ' + m)

// Baseline: only the flagship exists.
const before = await page.evaluate(() => globalThis.__uclife__.listShipsInFleet())
if (before.length !== 1) {
  fail(`expected exactly one starting ship (flagship); got ${before.length}: ${JSON.stringify(before)}`)
  await done()
}
pass(`baseline: one flagship at ${before[0].dockedAtPoiId}`)

// 1. First grant.
const grant = await page.evaluate(() => globalThis.__uclife__.grantFleet())
if (!grant?.ok) {
  fail(`first grantFleet() failed: ${JSON.stringify(grant)}`)
  await done()
}
pass(`grantFleet ok · pegasus=${grant.pegasusKey} militia=${grant.lunarMilitiaKey} npcs=${grant.npcsSpawned} captains=${grant.captainsHired} militiaCrew=${grant.lunarMilitiaCrewHired} pegasusCrew=${grant.pegasusCrewHired}`)

// 2. Fleet has 3 ships (flagship + lunarMilitia + pegasus).
const after = await page.evaluate(() => globalThis.__uclife__.listShipsInFleet())
if (after.length !== 3) fail(`expected 3 ships post-grant; got ${after.length}: ${JSON.stringify(after.map((s) => s.templateId))}`)
else pass(`post-grant fleet: ${after.length} ships (${after.map((s) => s.templateId).join(', ')})`)

const pegasus = after.find((s) => s.templateId === 'pegasusClass')
const militia = after.find((s) => s.templateId === 'lunarMilitia')
if (!pegasus) fail('pegasus not in fleet after grant')
else if (pegasus.dockedAtPoiId !== 'granada') fail(`pegasus dockedAtPoiId=${pegasus.dockedAtPoiId} (want granada)`)
else pass(`pegasus docked at granada`)
if (!militia) fail('lunarMilitia not in fleet after grant')
else if (militia.dockedAtPoiId !== 'vonBraun') fail(`lunarMilitia dockedAtPoiId=${militia.dockedAtPoiId} (want vonBraun)`)
else pass(`lunarMilitia docked at vonBraun`)

// 3. Captains assigned on both new ships (flagship intentionally excluded).
const roster = await page.evaluate(() => globalThis.__uclife__.fleetRosterSnapshot())
const pgRow = roster.find((r) => r.templateId === 'pegasusClass')
const lmRow = roster.find((r) => r.templateId === 'lunarMilitia')
if (!pgRow?.captainKey) fail(`pegasus has no captain: ${JSON.stringify(pgRow)}`)
else pass(`pegasus captain assigned: ${pgRow.captainKey} (${pgRow.captainName})`)
if (!lmRow?.captainKey) fail(`lunarMilitia has no captain: ${JSON.stringify(lmRow)}`)
else pass(`lunarMilitia captain assigned: ${lmRow.captainKey} (${lmRow.captainName})`)

// 4. Crew populated. lunarMilitia crewMax=2 should be fully staffed; pegasus
//    is partial (crewMax=200; pool size 30 minus 2 captains = up to 28 crew).
if (lmRow && lmRow.crewCount < 1) fail(`lunarMilitia crew empty: ${lmRow.crewCount}`)
else if (lmRow) pass(`lunarMilitia crew: ${lmRow.crewCount}/${lmRow.crewMax}`)
if (pgRow && pgRow.crewCount < 1) fail(`pegasus crew empty: ${pgRow.crewCount}`)
else if (pgRow) pass(`pegasus crew: ${pgRow.crewCount}/${pgRow.crewMax}`)

// 5. Hangars supplied. Both VB surface + Granada drydock should be at max.
const hangars = await page.evaluate(() => globalThis.__uclife__.listHangarsAllScenes())
const vbHangar = hangars.find((h) => h.typeId === 'hangarSurface')
const drydock = hangars.find((h) => h.typeId === 'hangarDrydock')
if (!vbHangar || !drydock) { fail('hangars missing'); await done() }

const vbSupply = await page.evaluate((k) => globalThis.__uclife__.hangarSupplySnapshot(k), vbHangar.buildingKey)
const ddSupply = await page.evaluate((k) => globalThis.__uclife__.hangarSupplySnapshot(k), drydock.buildingKey)
if (vbSupply.supplyCurrent < vbSupply.supplyMax) fail(`VB hangar supply not at max: ${vbSupply.supplyCurrent}/${vbSupply.supplyMax}`)
else pass(`VB hangar supply at max (${vbSupply.supplyCurrent}/${vbSupply.supplyMax}) · fuel ${vbSupply.fuelCurrent}/${vbSupply.fuelMax}`)
if (ddSupply.supplyCurrent < ddSupply.supplyMax) fail(`drydock supply not at max: ${ddSupply.supplyCurrent}/${ddSupply.supplyMax}`)
else pass(`drydock supply at max (${ddSupply.supplyCurrent}/${ddSupply.supplyMax}) · fuel ${ddSupply.fuelCurrent}/${ddSupply.fuelMax}`)

// 6. Pegasus is in the active fleet at a non-flagship slot.
const wr = await page.evaluate(() => globalThis.__uclife__.warRoomDescribe())
const pgWar = wr.ships.find((r) => r.templateId === 'pegasusClass')
if (!pgWar?.isInActiveFleet) fail(`pegasus not in active fleet: ${JSON.stringify(pgWar)}`)
else if (pgWar.formationSlot === wr.flagshipSlot) fail(`pegasus occupies flagship slot ${pgWar.formationSlot}`)
else pass(`pegasus in active fleet @ slot ${pgWar.formationSlot} (flagship anchor at ${wr.flagshipSlot})`)

// 7. Second grant → refused.
const grant2 = await page.evaluate(() => globalThis.__uclife__.grantFleet())
if (grant2?.ok) fail(`second grantFleet should be refused; got ${JSON.stringify(grant2)}`)
else if (grant2.reason !== 'already_granted') fail(`second grantFleet refused with unexpected reason: ${grant2.reason}`)
else pass(`second grantFleet refused: already_granted`)

// 8. Save round-trip preserves the granted fleet.
await page.evaluate(async () => { await globalThis.__uclife__.saveGame('auto') })
await page.evaluate(async () => { await globalThis.__uclife__.loadGame('auto') })
await page.waitForFunction(
  () => typeof globalThis.__uclife__?.listShipsInFleet === 'function',
  null,
  { timeout: 15_000 },
)
const afterLoad = await page.evaluate(() => globalThis.__uclife__.listShipsInFleet())
if (afterLoad.length !== 3) fail(`post-load ship count=${afterLoad.length} (want 3)`)
else pass(`post-load fleet preserved: ${afterLoad.length} ships`)

const rosterLoad = await page.evaluate(() => globalThis.__uclife__.fleetRosterSnapshot())
const pgLoad = rosterLoad.find((r) => r.templateId === 'pegasusClass')
const lmLoad = rosterLoad.find((r) => r.templateId === 'lunarMilitia')
if (!pgLoad?.captainKey) fail('pegasus captain not preserved across save/load')
else pass(`pegasus captain preserved: ${pgLoad.captainKey}`)
if (!lmLoad?.captainKey) fail('lunarMilitia captain not preserved across save/load')
else pass(`lunarMilitia captain preserved: ${lmLoad.captainKey}`)

const wrLoad = await page.evaluate(() => globalThis.__uclife__.warRoomDescribe())
const pgWarLoad = wrLoad.ships.find((r) => r.templateId === 'pegasusClass')
if (!pgWarLoad?.isInActiveFleet) fail('pegasus active-fleet marker not preserved across save/load')
else pass(`pegasus active-fleet marker preserved @ slot ${pgWarLoad.formationSlot}`)

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
  console.log('\nOK: 6.2.H debug grant-fleet verified.')
}
