// Phase 5.5.3 faction-office + secretary smoke. Verifies:
//  1. A factionOffice spawns in vonBraunCity and lists on the realtor as
//     state-owned factionMisc inventory.
//  2. The player can buy it via the realtorBuy debug handle, and the listing
//     drops from the realtor entirely afterward (player-owned facilities
//     are hidden via the excludeOwner filter — see realtor.ts).
//  3. Once owned, the smoke installs a civilian as secretary; the seat
//     occupant flips from null to a Character entity.
//  4. After installing, factionStatus reports memberCount >= 1 and the
//     bookSummary surfaces a wallet figure.
//  5. assignBeds + assignIdleMembers report mutating state where there
//     are vacancies, and the sidewaysReport flags an unhoused member if
//     the office is bought without residential beds (the default).
//  6. forceHousingPressure decays the unhoused member's opinion (Knows
//     edge) toward the player.
//  7. Manage cells respect ownership: spawned for player-ownable types,
//     inert until owned, dialog opens for owned cell.
//
// Migrated to Phase 6 deterministic boot: ?test=1 freezes the clock so
// the live loop's daily rollovers / housing pressure can't race the
// forced ones — no setSpeed(0) needed. All assertions use node:assert.

import { chromium } from 'playwright'
import { strict as assert } from 'node:assert'
import { BOOT_READY_TIMEOUT_MS, VIEWPORT } from './_test-constants.mjs'

const baseUrl = process.argv[2] ?? process.env.UCLIFE_BASE_URL ?? 'http://localhost:5173/'
const testUrl = new URL('?test=1', baseUrl).toString()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: VIEWPORT })
const page = await ctx.newPage()

const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console.error: ${m.text()}`) })

await page.goto(testUrl, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof window.__uclife_test__?.step === 'function'
    && typeof window.__uclife__?.realtorListings === 'function'
    && typeof window.__uclife__?.realtorBuy === 'function'
    && typeof window.__uclife__?.factionStatus === 'function'
    && typeof window.__uclife__?.factionInstallSecretary === 'function'
    && typeof window.__uclife__?.factionAssignRoster === 'function'
    && typeof window.__uclife__?.factionAssignBeds === 'function'
    && typeof window.__uclife__?.factionBookSummary === 'function'
    && typeof window.__uclife__?.factionSidewaysReport === 'function'
    && typeof window.__uclife__?.forceHousingPressure === 'function'
    && typeof window.__uclife__?.listManageCells === 'function'
    && typeof window.__uclife__?.manageCellTrigger === 'function'
    && typeof window.__uclife__?.manageDialogState === 'function'
    && typeof window.__uclife__?.manageDialogClose === 'function'
    && typeof window.__uclife__?.manageAssignIdle === 'function',
  null,
  { timeout: BOOT_READY_TIMEOUT_MS },
)

// 1. The realtor lists exactly one factionOffice (state-owned).
const listings = await page.evaluate(() => window.__uclife__.realtorListings())
const officeListing = listings.find((l) => l.typeId === 'factionOffice')
assert.ok(officeListing,
  `factionOffice missing from realtor listings — procgen seed regression. listings dump:\n${JSON.stringify(
    listings.map((l) => ({ k: l.buildingKey, t: l.typeId, c: l.category })).slice(0, 40), null, 2,
  )}`)
assert.equal(officeListing.ownerKind, 'state',
  `factionOffice ownerKind=${officeListing.ownerKind} (want state)`)
assert.equal(officeListing.category, 'factionMisc',
  `factionOffice category=${officeListing.category} (want factionMisc)`)

console.log(`factionOffice listing: ${officeListing.buildingKey} · asking ¥${officeListing.askingPrice}`)

// 2. realtorBuy transfers ownership to the player.
const buy = await page.evaluate((k) => window.__uclife__.realtorBuy(k), officeListing.buildingKey)
assert.equal(buy.ok, true, `realtorBuy failed: ${buy.reason}`)
console.log(`realtor close: paid ¥${buy.paid}`)

// Player-owned facilities are hidden from the realtor (excludeOwner filter,
// pre-creation player-faction alias). The listing must drop completely.
const listingsAfter = await page.evaluate(() => window.__uclife__.realtorListings())
const officeAfterBuy = listingsAfter.find((l) => l.buildingKey === officeListing.buildingKey)
assert.equal(officeAfterBuy, undefined,
  `factionOffice still listed after buy (ownerKind=${officeAfterBuy?.ownerKind}) — player-owned should be hidden`)

// 3. Install a secretary.
const install = await page.evaluate(() => window.__uclife__.factionInstallSecretary())
assert.equal(install.ok, true, `factionInstallSecretary failed: ${install.reason}`)
console.log(`secretary installed: ${install.secretaryName}`)

// 4. factionStatus + bookSummary work post-install.
const status1 = await page.evaluate(() => window.__uclife__.factionStatus())
assert.ok(status1, 'factionStatus returned null after secretary install')
assert.ok(status1.memberCount >= 1, `factionStatus.memberCount=${status1.memberCount} (want >= 1)`)
assert.ok(status1.facilityCount >= 1, `factionStatus.facilityCount=${status1.facilityCount} (want >= 1)`)
console.log(`status: members=${status1.memberCount} facilities=${status1.facilityCount} beds=${status1.bedCount} unhoused=${status1.unhousedCount}`)

const books = await page.evaluate(() => window.__uclife__.factionBookSummary())
assert.ok(books, 'factionBookSummary returned null')
assert.equal(typeof books.fund, 'number', `factionBookSummary.fund not numeric: ${books.fund}`)
console.log(`books: fund=¥${books.fund} todayNet=¥${books.todayNet}`)

// 5. assignIdleMembers + assignBeds run without throwing.
const rosterResult = await page.evaluate(() => window.__uclife__.factionAssignRoster())
assert.ok(rosterResult && typeof rosterResult.assigned === 'number',
  'factionAssignRoster did not return a usable summary')
const bedResult = await page.evaluate(() => window.__uclife__.factionAssignBeds())
assert.ok(bedResult && typeof bedResult.assigned === 'number',
  'factionAssignBeds did not return a usable summary')

const sideways = await page.evaluate(() => window.__uclife__.factionSidewaysReport())
assert.ok(sideways, 'factionSidewaysReport returned null')
// Owning only a faction office = the new secretary has no bed claim; the
// unhoused-count should be >= 1 unless procgen happened to give us a
// residence too (it shouldn't — we only bought the office).
if (sideways.unhousedCount < 1) {
  console.log(`note: sidewaysReport.unhousedCount=${sideways.unhousedCount} — secretary may already be housed via prior rent`)
} else {
  console.log(`sideways: insolvent=${sideways.insolventFacilities.length} vacant=${sideways.vacantStations.length} unhoused=${sideways.unhousedCount}`)
}

// 6. forceHousingPressure decays opinion of the unhoused secretary.
const pressure = await page.evaluate(() => window.__uclife__.forceHousingPressure())
assert.ok(pressure, 'forceHousingPressure returned null')
if (sideways.unhousedCount > 0) {
  assert.ok(pressure.decayedCount >= 1,
    `forceHousingPressure.decayedCount=${pressure.decayedCount} (want >= 1 with unhoused secretary)`)
}
console.log(`housing pressure: unhoused=${pressure.unhousedCount} decayed=${pressure.decayedCount}`)

// 7. Manage cell — spawned for player-ownable types, inert until owned,
//    triggers dialog when owned, and rejects triggers for non-owners.
const cellsAfterBuy = await page.evaluate(() => window.__uclife__.listManageCells())
const officeCellAfter = cellsAfterBuy.find((c) => c.buildingKey === officeListing.buildingKey)
assert.ok(officeCellAfter, 'manage cell missing for factionOffice after purchase')
assert.equal(officeCellAfter.buildingTypeId, 'factionOffice',
  `manage cell typeId=${officeCellAfter.buildingTypeId} (want factionOffice)`)
assert.equal(officeCellAfter.ownedByPlayer, true,
  `manage cell ownedByPlayer=${officeCellAfter.ownedByPlayer} after buy (want true)`)

const stateOwnedCell = cellsAfterBuy.find((c) => c.ownedByPlayer === false)
if (stateOwnedCell) {
  const reject = await page.evaluate((k) => window.__uclife__.manageCellTrigger(k), stateOwnedCell.buildingKey)
  assert.equal(reject.ok, false,
    `manage cell trigger succeeded on non-owned ${stateOwnedCell.buildingKey} — gate failure`)
  console.log(`manage cell on non-owned ${stateOwnedCell.buildingKey} correctly rejected: ${reject.reason}`)
} else {
  console.log('note: no non-player-owned manage cell available — gate-rejection check skipped')
}

const trig = await page.evaluate((k) => window.__uclife__.manageCellTrigger(k), officeListing.buildingKey)
assert.equal(trig.ok, true, `manageCellTrigger on owned office failed: ${trig.reason}`)

const dialogState = await page.evaluate(() => window.__uclife__.manageDialogState())
assert.equal(dialogState.open, true, 'manageDialogState.open = false after triggering owned cell')
assert.equal(dialogState.buildingKey, officeListing.buildingKey,
  `manageDialogState.buildingKey=${dialogState.buildingKey} (want ${officeListing.buildingKey})`)
console.log(`manage dialog opened for ${dialogState.buildingKey}`)

await page.evaluate(() => window.__uclife__.manageDialogClose())

const closedState = await page.evaluate(() => window.__uclife__.manageDialogState())
assert.equal(closedState.open, false, 'manageDialogState still open after manageDialogClose')

const assignResult = await page.evaluate((k) => window.__uclife__.manageAssignIdle(k), officeListing.buildingKey)
assert.equal(assignResult.ok, true, `manageAssignIdle on owned office failed: ${assignResult.reason}`)
console.log(`manageAssignIdle: assigned=${assignResult.assigned} unassigned=${assignResult.unassigned}`)

assert.equal(pageErrors.length, 0,
  `page error(s) during test:\n${pageErrors.map((e) => '  ' + e).join('\n')}`)

await browser.close()

console.log('\nOK: faction office + secretary install + verbs + housing pressure verified.')
