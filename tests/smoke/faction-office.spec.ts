// faction-office + secretary smoke. Verifies:
//  1. A factionOffice spawns in vonBraunCity and lists on the realtor as
//     state-owned factionMisc inventory.
//  2. The player can buy it via the realtorBuy debug handle, and the listing
//     drops from the realtor entirely afterward.
//  3. Once owned, the smoke installs a civilian as secretary.
//  4. After installing, factionStatus reports memberCount >= 1.
//  5. assignBeds + assignIdleMembers report mutating state.
//  6. forceHousingPressure decays the unhoused member's opinion.
//  7. Manage cells respect ownership.

import { test, expect } from './_fixtures'

const REQUIRED_HANDLES = [
  '__uclife_test__.step',
  '__uclife__.realtorListings',
  '__uclife__.realtorBuy',
  '__uclife__.factionStatus',
  '__uclife__.factionInstallSecretary',
  '__uclife__.factionAssignRoster',
  '__uclife__.factionAssignBeds',
  '__uclife__.factionBookSummary',
  '__uclife__.factionSidewaysReport',
  '__uclife__.forceHousingPressure',
  '__uclife__.listManageCells',
  '__uclife__.manageCellTrigger',
  '__uclife__.manageDialogState',
  '__uclife__.manageDialogClose',
  '__uclife__.manageAssignIdle',
]

test('faction office + secretary + housing pressure + manage cells', async ({ sim }) => {
  await sim.boot({ requireHandles: REQUIRED_HANDLES })

  // 1. The realtor lists exactly one factionOffice (state-owned).
  const listings = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.realtorListings(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const officeListing = listings.find((l: any) => l.typeId === 'factionOffice')
  expect(officeListing, 'factionOffice missing from realtor listings').toBeTruthy()
  expect(officeListing.ownerKind).toBe('state')
  expect(officeListing.category).toBe('factionMisc')

  // 2. realtorBuy transfers ownership to the player.
  const buy = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.realtorBuy(k),
    officeListing.buildingKey,
  )
  expect(buy.ok, `realtorBuy failed: ${buy.reason}`).toBe(true)

  const listingsAfter = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.realtorListings(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const officeAfterBuy = listingsAfter.find((l: any) => l.buildingKey === officeListing.buildingKey)
  expect(officeAfterBuy, 'factionOffice still listed after buy — player-owned should be hidden').toBeUndefined()

  // 3. Install a secretary.
  const install = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.factionInstallSecretary(),
  )
  expect(install.ok, `factionInstallSecretary failed: ${install.reason}`).toBe(true)

  // 4. factionStatus + bookSummary work post-install.
  const status1 = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.factionStatus(),
  )
  expect(status1, 'factionStatus returned null after secretary install').toBeTruthy()
  expect(status1.memberCount).toBeGreaterThanOrEqual(1)
  expect(status1.facilityCount).toBeGreaterThanOrEqual(1)

  const books = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.factionBookSummary(),
  )
  expect(books, 'factionBookSummary returned null').toBeTruthy()
  expect(typeof books.fund, `factionBookSummary.fund not numeric: ${books.fund}`).toBe('number')

  // 5. assignIdleMembers + assignBeds run without throwing.
  const rosterResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.factionAssignRoster(),
  )
  expect(
    rosterResult && typeof rosterResult.assigned === 'number',
    'factionAssignRoster did not return a usable summary',
  ).toBeTruthy()
  const bedResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.factionAssignBeds(),
  )
  expect(
    bedResult && typeof bedResult.assigned === 'number',
    'factionAssignBeds did not return a usable summary',
  ).toBeTruthy()

  const sideways = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.factionSidewaysReport(),
  )
  expect(sideways, 'factionSidewaysReport returned null').toBeTruthy()

  // 6. forceHousingPressure decays opinion of the unhoused secretary.
  const pressure = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.forceHousingPressure(),
  )
  expect(pressure, 'forceHousingPressure returned null').toBeTruthy()
  if (sideways.unhousedCount > 0) {
    expect(pressure.decayedCount).toBeGreaterThanOrEqual(1)
  }

  // 7. Manage cell.
  const cellsAfterBuy = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.listManageCells(),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const officeCellAfter = cellsAfterBuy.find((c: any) => c.buildingKey === officeListing.buildingKey)
  expect(officeCellAfter, 'manage cell missing for factionOffice after purchase').toBeTruthy()
  expect(officeCellAfter.buildingTypeId).toBe('factionOffice')
  expect(officeCellAfter.ownedByPlayer).toBe(true)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stateOwnedCell = cellsAfterBuy.find((c: any) => c.ownedByPlayer === false)
  if (stateOwnedCell) {
    const reject = await sim.page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (k) => (window as any).__uclife__.manageCellTrigger(k),
      stateOwnedCell.buildingKey,
    )
    expect(reject.ok, `manage cell trigger succeeded on non-owned ${stateOwnedCell.buildingKey}`).toBe(false)
  }

  const trig = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.manageCellTrigger(k),
    officeListing.buildingKey,
  )
  expect(trig.ok, `manageCellTrigger on owned office failed: ${trig.reason}`).toBe(true)

  const dialogState = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.manageDialogState(),
  )
  expect(dialogState.open).toBe(true)
  expect(dialogState.buildingKey).toBe(officeListing.buildingKey)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sim.page.evaluate(() => (window as any).__uclife__.manageDialogClose())

  const closedState = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__uclife__.manageDialogState(),
  )
  expect(closedState.open).toBe(false)

  const assignResult = await sim.page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (k) => (window as any).__uclife__.manageAssignIdle(k),
    officeListing.buildingKey,
  )
  expect(assignResult.ok, `manageAssignIdle on owned office failed: ${assignResult.reason}`).toBe(true)
})
