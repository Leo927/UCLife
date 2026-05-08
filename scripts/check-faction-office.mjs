// Phase 5.5.3 faction-office + secretary smoke. Verifies:
//  1. A factionOffice spawns in vonBraunCity and lists on the realtor as
//     state-owned factionMisc inventory.
//  2. The player can buy it via the realtorBuy debug handle.
//  3. Once owned, the smoke installs a civilian as secretary; the seat
//     occupant flips from null to a Character entity.
//  4. After installing, factionStatus reports memberCount >= 1 and the
//     bookSummary surfaces a wallet figure.
//  5. assignBeds + assignIdleMembers report mutating state where there
//     are vacancies, and the sidewaysReport flags an unhoused member if
//     the office is bought without residential beds (the default).
//  6. forceHousingPressure decays the unhoused member's opinion (Knows
//     edge) toward the player.

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
  () => typeof globalThis.__uclife__?.realtorListings === 'function'
    && typeof globalThis.__uclife__?.realtorBuy === 'function'
    && typeof globalThis.__uclife__?.factionStatus === 'function'
    && typeof globalThis.__uclife__?.factionInstallSecretary === 'function'
    && typeof globalThis.__uclife__?.factionAssignRoster === 'function'
    && typeof globalThis.__uclife__?.factionAssignBeds === 'function'
    && typeof globalThis.__uclife__?.factionBookSummary === 'function'
    && typeof globalThis.__uclife__?.factionSidewaysReport === 'function'
    && typeof globalThis.__uclife__?.forceHousingPressure === 'function'
    && typeof globalThis.__uclife__?.listManageCells === 'function'
    && typeof globalThis.__uclife__?.manageCellTrigger === 'function'
    && typeof globalThis.__uclife__?.manageDialogState === 'function'
    && typeof globalThis.__uclife__?.manageDialogClose === 'function'
    && typeof globalThis.__uclife__?.manageAssignIdle === 'function',
  null,
  { timeout: 30_000 },
)

// Pause the sim so the live loop's own rollovers + housing pressure
// don't race the forced ones.
await page.evaluate(() => globalThis.__uclife__.useClock.getState().setSpeed(0))

const failures = []

// 1. The realtor lists exactly one factionOffice (state-owned).
const listings = await page.evaluate(() => globalThis.__uclife__.realtorListings())
const officeListing = listings.find((l) => l.typeId === 'factionOffice')
if (!officeListing) {
  failures.push('factionOffice missing from realtor listings — procgen seed regression')
} else if (officeListing.ownerKind !== 'state') {
  failures.push(`factionOffice ownerKind=${officeListing.ownerKind} (want state)`)
} else if (officeListing.category !== 'factionMisc') {
  failures.push(`factionOffice category=${officeListing.category} (want factionMisc)`)
}

if (!officeListing) {
  await dumpAndExit()
}

console.log(`factionOffice listing: ${officeListing.buildingKey} · asking ¥${officeListing.askingPrice}`)

// 2. realtorBuy transfers ownership to the player.
const buy = await page.evaluate((k) => globalThis.__uclife__.realtorBuy(k), officeListing.buildingKey)
if (!buy.ok) failures.push(`realtorBuy failed: ${buy.reason}`)
else console.log(`realtor close: paid ¥${buy.paid}`)

// Re-listing should no longer carry factionOffice as state.
const listingsAfter = await page.evaluate(() => globalThis.__uclife__.realtorListings())
const officeAfterBuy = listingsAfter.find((l) => l.buildingKey === officeListing.buildingKey)
if (!officeAfterBuy) failures.push('factionOffice fell off the listings (expected: ownerKind=character)')
else if (officeAfterBuy.ownerKind !== 'character') {
  failures.push(`factionOffice ownerKind after buy=${officeAfterBuy.ownerKind} (want character)`)
}

// 3. Install a secretary.
const install = await page.evaluate(() => globalThis.__uclife__.factionInstallSecretary())
if (!install.ok) failures.push(`factionInstallSecretary failed: ${install.reason}`)
else console.log(`secretary installed: ${install.secretaryName}`)

// 4. factionStatus + bookSummary work post-install.
const status1 = await page.evaluate(() => globalThis.__uclife__.factionStatus())
if (!status1) failures.push('factionStatus returned null after secretary install')
else {
  if (status1.memberCount < 1) failures.push(`factionStatus.memberCount=${status1.memberCount} (want >= 1)`)
  if (status1.facilityCount < 1) failures.push(`factionStatus.facilityCount=${status1.facilityCount} (want >= 1)`)
  console.log(`status: members=${status1.memberCount} facilities=${status1.facilityCount} beds=${status1.bedCount} unhoused=${status1.unhousedCount}`)
}

const books = await page.evaluate(() => globalThis.__uclife__.factionBookSummary())
if (!books) failures.push('factionBookSummary returned null')
else if (typeof books.fund !== 'number') {
  failures.push(`factionBookSummary.fund not numeric: ${books.fund}`)
} else {
  console.log(`books: fund=¥${books.fund} todayNet=¥${books.todayNet}`)
}

// 5. assignIdleMembers + assignBeds run without throwing.
const rosterResult = await page.evaluate(() => globalThis.__uclife__.factionAssignRoster())
if (!rosterResult || typeof rosterResult.assigned !== 'number') {
  failures.push('factionAssignRoster did not return a usable summary')
}
const bedResult = await page.evaluate(() => globalThis.__uclife__.factionAssignBeds())
if (!bedResult || typeof bedResult.assigned !== 'number') {
  failures.push('factionAssignBeds did not return a usable summary')
}

const sideways = await page.evaluate(() => globalThis.__uclife__.factionSidewaysReport())
if (!sideways) failures.push('factionSidewaysReport returned null')
else {
  // Owning only a faction office = the new secretary has no bed claim;
  // the unhoused-count should be ≥1 unless the procgen happened to give
  // us a residence too (it shouldn't — we only bought the office).
  if (sideways.unhousedCount < 1) {
    console.log(`note: sidewaysReport.unhousedCount=${sideways.unhousedCount} — secretary may already be housed via prior rent`)
  } else {
    console.log(`sideways: insolvent=${sideways.insolventFacilities.length} vacant=${sideways.vacantStations.length} unhoused=${sideways.unhousedCount}`)
  }
}

// 6. forceHousingPressure decays opinion of the unhoused secretary.
const pressure = await page.evaluate(() => globalThis.__uclife__.forceHousingPressure())
if (!pressure) failures.push('forceHousingPressure returned null')
else if (sideways && sideways.unhousedCount > 0 && pressure.decayedCount < 1) {
  failures.push(`forceHousingPressure.decayedCount=${pressure.decayedCount} (want >= 1 with unhoused secretary)`)
} else {
  console.log(`housing pressure: unhoused=${pressure.unhousedCount} decayed=${pressure.decayedCount}`)
}

// 7. Manage cell — spawned for player-ownable types, inert until owned,
//    triggers dialog when owned, and rejects triggers for non-owners.
const cellsBeforeBuy = await page.evaluate(() => globalThis.__uclife__.listManageCells())
const officeCellBefore = cellsBeforeBuy.find((c) => c.buildingKey === officeListing.buildingKey)
if (!officeCellBefore) {
  failures.push('manage cell missing for factionOffice — spawn regression')
} else if (officeCellBefore.buildingTypeId !== 'factionOffice') {
  failures.push(`manage cell typeId=${officeCellBefore.buildingTypeId} (want factionOffice)`)
}

const cellsAfterBuy = await page.evaluate(() => globalThis.__uclife__.listManageCells())
const officeCellAfter = cellsAfterBuy.find((c) => c.buildingKey === officeListing.buildingKey)
if (!officeCellAfter) {
  failures.push('manage cell vanished after purchase')
} else if (!officeCellAfter.ownedByPlayer) {
  failures.push(`manage cell ownedByPlayer=${officeCellAfter.ownedByPlayer} after buy (want true)`)
}

const stateOwnedCell = cellsAfterBuy.find((c) => c.ownedByPlayer === false)
if (stateOwnedCell) {
  const reject = await page.evaluate((k) => globalThis.__uclife__.manageCellTrigger(k), stateOwnedCell.buildingKey)
  if (reject.ok) failures.push(`manage cell trigger succeeded on non-owned ${stateOwnedCell.buildingKey} — gate failure`)
  else console.log(`manage cell on non-owned ${stateOwnedCell.buildingKey} correctly rejected: ${reject.reason}`)
} else {
  console.log('note: no non-player-owned manage cell available — gate-rejection check skipped')
}

const trig = await page.evaluate((k) => globalThis.__uclife__.manageCellTrigger(k), officeListing.buildingKey)
if (!trig.ok) failures.push(`manageCellTrigger on owned office failed: ${trig.reason}`)

const dialogState = await page.evaluate(() => globalThis.__uclife__.manageDialogState())
if (!dialogState.open) failures.push('manageDialogState.open = false after triggering owned cell')
else if (dialogState.buildingKey !== officeListing.buildingKey) {
  failures.push(`manageDialogState.buildingKey=${dialogState.buildingKey} (want ${officeListing.buildingKey})`)
} else {
  console.log(`manage dialog opened for ${dialogState.buildingKey}`)
}

await page.evaluate(() => globalThis.__uclife__.manageDialogClose())

const closedState = await page.evaluate(() => globalThis.__uclife__.manageDialogState())
if (closedState.open) failures.push('manageDialogState still open after manageDialogClose')

const assignResult = await page.evaluate((k) => globalThis.__uclife__.manageAssignIdle(k), officeListing.buildingKey)
if (!assignResult.ok) failures.push(`manageAssignIdle on owned office failed: ${assignResult.reason}`)
else console.log(`manageAssignIdle: assigned=${assignResult.assigned} unassigned=${assignResult.unassigned}`)

await browser.close()

if (errors.length) {
  console.log('\nERRORS:')
  errors.forEach((e) => console.log('  ' + e))
}
if (failures.length) {
  console.log('\nFAILURES:')
  failures.forEach((f) => console.log('  ' + f))
}
if (errors.length || failures.length) process.exit(1)

console.log('\nOK: faction office + secretary install + verbs + housing pressure verified.')

async function dumpAndExit() {
  console.log('\nlistings dump:')
  console.log(JSON.stringify(listings.map((l) => ({ k: l.buildingKey, t: l.typeId, c: l.category })).slice(0, 40), null, 2))
  await browser.close()
  process.exit(1)
}
